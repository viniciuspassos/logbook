import { UnauthorizedException, type INestApplication } from '@nestjs/common'
import request from 'supertest'
import { CSRF_HEADER_NAME } from '../cookies'
import type { GoogleIdentity } from '../google-token-verifier.service'
import { LOGIN_CLIENT_HEADER_NAME, LOGIN_CLIENT_HEADER_VALUE } from '../google-login-request.guard'

/**
 * Test-only helper shared by the e2e suites: not independently unit-tested,
 * matching this codebase's convention for fixture helpers (fakeEntry/
 * makeRepoMock/etc. throughout src/**\/*.test.ts are likewise untested —
 * they're test tooling, not production code).
 */

export const TEST_GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com'
export const TEST_USER_A_EMAIL = 'alice@example.com'
export const TEST_USER_B_EMAIL = 'bob@example.com'
/** In no allowlist: a verified Google account that must get 403. */
export const TEST_STRANGER_EMAIL = 'stranger@example.com'

/** The auth-related env vars for loadConfig() in e2e test setup. */
export const TEST_AUTH_ENV = {
  GOOGLE_AUTH_ENABLED: 'true',
  GOOGLE_CLIENT_ID: TEST_GOOGLE_CLIENT_ID,
  ALLOWED_EMAILS: `${TEST_USER_A_EMAIL},${TEST_USER_B_EMAIL}`,
}

const TEST_TOKEN_PREFIX = 'test-token:'

/** The fake "ID token" the e2e suites send for a given Google account. */
export function idTokenFor(email: string): string {
  return `${TEST_TOKEN_PREFIX}${email}`
}

/**
 * Stand-in for GoogleTokenVerifier (override the provider with this in e2e
 * modules): accepts `idTokenFor(email)` tokens as a verified Google identity
 * and rejects everything else like the real verifier would, so no test ever
 * talks to Google.
 */
export const fakeGoogleTokenVerifier = {
  verify(idToken: string): Promise<GoogleIdentity> {
    if (!idToken.startsWith(TEST_TOKEN_PREFIX)) {
      return Promise.reject(new UnauthorizedException('Invalid Google ID token'))
    }
    const email = idToken.slice(TEST_TOKEN_PREFIX.length)
    return Promise.resolve({
      sub: `sub-${email}`,
      email,
      name: email.split('@')[0],
      picture: null,
    })
  },
}

export interface AuthenticatedRequestContext {
  /** Value for the `Cookie` request header on every subsequent authenticated request. */
  cookieHeader: string
  /** Value for the `X-CSRF-Token` request header on every mutating request. */
  csrfToken: string
}

/** Signs in as the given account against a booted test app and extracts the session + CSRF cookies supertest needs to replay. */
export async function loginForTests(
  app: INestApplication,
  email: string = TEST_USER_A_EMAIL,
): Promise<AuthenticatedRequestContext> {
  const res = await request(app.getHttpServer())
    .post('/auth/google')
    .set(LOGIN_CLIENT_HEADER_NAME, LOGIN_CLIENT_HEADER_VALUE)
    .send({ idToken: idTokenFor(email) })
    .expect(200)

  const setCookieHeader = res.headers['set-cookie']
  const rawCookies: string[] = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : typeof setCookieHeader === 'string'
      ? [setCookieHeader]
      : []

  const cookies = parseCookies(rawCookies)
  const csrfToken = cookies['logbook_csrf']
  const sessionToken = cookies['logbook_session']
  if (!csrfToken || !sessionToken) {
    throw new Error('Login response did not set the expected session/csrf cookies')
  }

  return {
    cookieHeader: rawCookies.map((cookie) => cookie.split(';')[0]).join('; '),
    csrfToken,
  }
}

/** Attaches the auth cookie (and, for mutating requests, the CSRF header) to a supertest request. */
export function withAuth<T extends { set: (field: string, value: string) => T }>(
  req: T,
  ctx: AuthenticatedRequestContext,
  { mutating = false }: { mutating?: boolean } = {},
): T {
  req.set('Cookie', ctx.cookieHeader)
  if (mutating) {
    req.set(CSRF_HEADER_NAME, ctx.csrfToken)
  }
  return req
}

function parseCookies(setCookieHeaders: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const header of setCookieHeaders) {
    const [pair] = header.split(';')
    const separatorIndex = pair.indexOf('=')
    if (separatorIndex === -1) {
      continue
    }
    const name = pair.slice(0, separatorIndex).trim()
    const value = pair.slice(separatorIndex + 1).trim()
    result[name] = value
  }
  return result
}

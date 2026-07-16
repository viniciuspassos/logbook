import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { PasswordHasherService } from '../password-hasher.service'
import { CSRF_HEADER_NAME } from '../cookies'

/**
 * Test-only helper shared by entries/attachments e2e suites: not
 * independently unit-tested, matching this codebase's convention for
 * fixture helpers (fakeEntry/makeRepoMock/etc. throughout src/**\/*.test.ts
 * are likewise untested — they're test tooling, not production code).
 */

export const TEST_LOGIN_PASSWORD = 'correct horse battery staple'

/** Computes an AUTH_PASSWORD_HASH for TEST_LOGIN_PASSWORD, for loadConfig() in e2e test setup. */
export async function testAuthPasswordHash(): Promise<string> {
  return new PasswordHasherService().hash(TEST_LOGIN_PASSWORD)
}

export interface AuthenticatedRequestContext {
  /** Value for the `Cookie` request header on every subsequent authenticated request. */
  cookieHeader: string
  /** Value for the `X-CSRF-Token` request header on every mutating request. */
  csrfToken: string
}

/** Logs in against a booted test app and extracts the session + CSRF cookies supertest needs to replay. */
export async function loginForTests(app: INestApplication): Promise<AuthenticatedRequestContext> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ password: TEST_LOGIN_PASSWORD })
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

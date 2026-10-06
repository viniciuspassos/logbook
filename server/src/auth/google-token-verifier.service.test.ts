import { Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { OAuth2Client, type LoginTicket, type TokenPayload } from 'google-auth-library'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { CERT_FETCH_FAILURE_PREFIX, GoogleTokenVerifier } from './google-token-verifier.service'

jest.mock('google-auth-library')

const CLIENT_ID = 'client-id.apps.googleusercontent.com'

function makeConfigService(): ConfigService {
  return {
    getOrThrow: jest.fn().mockReturnValue({ googleClientId: CLIENT_ID }),
  } as unknown as ConfigService
}

function ticketWith(payload: Partial<TokenPayload> | undefined): LoginTicket {
  return { getPayload: () => payload as TokenPayload | undefined } as unknown as LoginTicket
}

function setup() {
  const verifyIdToken = jest.fn()
  const MockedClient = jest.mocked(OAuth2Client)
  MockedClient.mockClear()
  MockedClient.mockImplementation(
    () => ({ verifyIdToken }) as unknown as InstanceType<typeof OAuth2Client>,
  )
  const verifier = new GoogleTokenVerifier(makeConfigService())
  return { verifier, verifyIdToken, MockedClient }
}

describe('GoogleTokenVerifier', () => {
  it('builds nothing at construction (so a disabled deployment never creates a Google client)', () => {
    const { MockedClient } = setup()

    expect(MockedClient).not.toHaveBeenCalled()
  })

  it('builds its OAuth2Client from the configured client ID on first use, and only once', async () => {
    const { verifier, verifyIdToken, MockedClient } = setup()
    verifyIdToken.mockResolvedValue(
      ticketWith({ sub: 's', email: 'me@example.com', email_verified: true }),
    )

    await verifier.verify('a')
    await verifier.verify('b')

    expect(MockedClient).toHaveBeenCalledTimes(1)
    expect(MockedClient).toHaveBeenCalledWith(CLIENT_ID)
  })

  it('verifies the token against the configured audience and returns the narrow identity', async () => {
    const { verifier, verifyIdToken } = setup()
    verifyIdToken.mockResolvedValue(
      ticketWith({
        sub: 'sub-1',
        email: 'Me@Example.com',
        email_verified: true,
        name: 'Me',
        picture: 'https://example.com/me.png',
      }),
    )

    const identity = await verifier.verify('id-token')

    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: 'id-token', audience: CLIENT_ID })
    expect(identity).toEqual({
      sub: 'sub-1',
      email: 'me@example.com',
      name: 'Me',
      picture: 'https://example.com/me.png',
    })
  })

  it('maps a missing name/picture to null', async () => {
    const { verifier, verifyIdToken } = setup()
    verifyIdToken.mockResolvedValue(
      ticketWith({ sub: 'sub-1', email: 'me@example.com', email_verified: true }),
    )

    await expect(verifier.verify('id-token')).resolves.toEqual({
      sub: 'sub-1',
      email: 'me@example.com',
      name: null,
      picture: null,
    })
  })

  it('rejects with a generic 401 when the library throws (bad signature, audience, expiry)', async () => {
    const { verifier, verifyIdToken } = setup()
    verifyIdToken.mockRejectedValue(new Error('Wrong recipient, payload audience != requiredAudience'))

    await expect(verifier.verify('forged')).rejects.toBeInstanceOf(UnauthorizedException)
    await expect(verifier.verify('forged')).rejects.toThrow('Invalid Google ID token')
  })

  it.each([
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'EPIPE',
    'ECONNABORTED',
    'ENETUNREACH',
    'EHOSTUNREACH',
  ])('answers 503 and logs (not a 401) for the network error code %s', async (code) => {
    const { verifier, verifyIdToken } = setup()
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    verifyIdToken.mockRejectedValue(Object.assign(new Error('network'), { code }))

    await expect(verifier.verify('valid-token')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it.each([
    ['an upstream 5xx on the error', Object.assign(new Error('bad gateway'), { status: 502 })],
    [
      'an upstream 5xx on the response',
      Object.assign(new Error('x'), { response: { status: 500 } }),
    ],
    [
      "the library's cert-fetch failure",
      new Error(`${CERT_FETCH_FAILURE_PREFIX}: Request failed with status code 503`),
    ],
  ])('answers 503 and logs for %s', async (_label, error) => {
    const { verifier, verifyIdToken } = setup()
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    verifyIdToken.mockRejectedValue(error)

    await expect(verifier.verify('valid-token')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
    warnSpy.mockRestore()
  })

  it.each([
    ['an unlisted E* code', Object.assign(new Error('permission'), { code: 'EACCES' })],
    ['an ERR_* code', Object.assign(new Error('tls'), { code: 'ERR_SSL_WRONG_VERSION_NUMBER' })],
    ['a 4xx status', Object.assign(new Error('forbidden'), { status: 403 })],
    ['a 4xx on the response', Object.assign(new Error('x'), { response: { status: 404 } })],
    ['a plain invalid-token error', new Error('Wrong recipient, payload audience != requiredAudience')],
  ])('keeps answering 401 for %s (an invalid token, not an outage)', async (_label, error) => {
    const { verifier, verifyIdToken } = setup()
    verifyIdToken.mockRejectedValue(error)

    await expect(verifier.verify('t')).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('pins the cert-fetch failure prefix to the installed google-auth-library version', () => {
    // If a library upgrade changes this message, this fails loudly instead of
    // silently turning cert-fetch outages back into 401s.
    const libraryDir = path.dirname(require.resolve('google-auth-library'))
    const source = fs.readFileSync(path.join(libraryDir, 'auth', 'oauth2client.js'), 'utf8')

    expect(source).toContain(`${CERT_FETCH_FAILURE_PREFIX}:`)
  })

  it('still answers 401 for a non-Error rejection from the library', async () => {
    const { verifier, verifyIdToken } = setup()
    verifyIdToken.mockRejectedValue('weird')

    await expect(verifier.verify('t')).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('rejects a token with no payload', async () => {
    const { verifier, verifyIdToken } = setup()
    verifyIdToken.mockResolvedValue(ticketWith(undefined))

    await expect(verifier.verify('t')).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('rejects a token whose e-mail is not verified', async () => {
    const { verifier, verifyIdToken } = setup()
    verifyIdToken.mockResolvedValue(
      ticketWith({ sub: 'sub-1', email: 'me@example.com', email_verified: false }),
    )

    await expect(verifier.verify('t')).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('rejects a token missing sub or e-mail', async () => {
    const { verifier, verifyIdToken } = setup()
    verifyIdToken.mockResolvedValue(ticketWith({ email: 'me@example.com', email_verified: true }))
    await expect(verifier.verify('t')).rejects.toBeInstanceOf(UnauthorizedException)

    verifyIdToken.mockResolvedValue(ticketWith({ sub: 'sub-1', email_verified: true }))
    await expect(verifier.verify('t')).rejects.toBeInstanceOf(UnauthorizedException)
  })
})

import { Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { OAuth2Client, type LoginTicket, type TokenPayload } from 'google-auth-library'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  GoogleTokenVerifier,
  KNOWN_INVALID_TOKEN_MESSAGES,
} from './google-token-verifier.service'

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

  it.each(KNOWN_INVALID_TOKEN_MESSAGES)(
    'answers a generic 401 for the library\'s known token failure %p',
    async (prefix) => {
      const { verifier, verifyIdToken } = setup()
      verifyIdToken.mockRejectedValue(new Error(`${prefix} (details the caller must not see)`))

      await expect(verifier.verify('forged')).rejects.toBeInstanceOf(UnauthorizedException)
      await expect(verifier.verify('forged')).rejects.toThrow('Invalid Google ID token')
    },
  )

  it('pins every known invalid-token message to the installed google-auth-library source', () => {
    // If a library upgrade rewords one of these, this fails loudly instead of
    // silently turning that token failure into a 503.
    const libraryDir = path.dirname(require.resolve('google-auth-library'))
    const source = fs.readFileSync(path.join(libraryDir, 'auth', 'oauth2client.js'), 'utf8')

    for (const prefix of KNOWN_INVALID_TOKEN_MESSAGES) {
      expect(source).toContain(prefix)
    }
  })

  it.each([
    ['a network error', Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })],
    ['an AbortError', Object.assign(new Error('aborted'), { name: 'AbortError' })],
    ['a TLS error', Object.assign(new Error('tls'), { code: 'ERR_SSL_WRONG_VERSION_NUMBER' })],
    ['an unlisted E* code', Object.assign(new Error('permission'), { code: 'EACCES' })],
    ['an upstream 5xx', Object.assign(new Error('bad gateway'), { status: 502 })],
    ['a gaxios 4xx', Object.assign(new Error('forbidden'), { response: { status: 403 } })],
    [
      "the library's cert-fetch failure",
      new Error('Failed to retrieve verification certificates: Request failed with status code 503'),
    ],
    ['a non-Error rejection', 'weird'],
    ['undefined', undefined],
    ['an unrecognised Error', new Error('something we have never seen')],
  ])(
    'fails toward 503 and logs, not 401, for %s (anything not a known token failure)',
    async (_label, error) => {
      const { verifier, verifyIdToken } = setup()
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      verifyIdToken.mockRejectedValue(error)

      await expect(verifier.verify('valid-token')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      )
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    },
  )

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

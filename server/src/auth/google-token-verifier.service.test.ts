import { UnauthorizedException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { OAuth2Client, type LoginTicket, type TokenPayload } from 'google-auth-library'
import { GoogleTokenVerifier } from './google-token-verifier.service'

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
  MockedClient.mockImplementation(
    () => ({ verifyIdToken }) as unknown as InstanceType<typeof OAuth2Client>,
  )
  const verifier = new GoogleTokenVerifier(makeConfigService())
  return { verifier, verifyIdToken, MockedClient }
}

describe('GoogleTokenVerifier', () => {
  it('builds its OAuth2Client from the configured client ID', () => {
    const { MockedClient } = setup()

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

import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { AuthService } from './auth.service'
import type { GoogleIdentity, GoogleTokenVerifier } from './google-token-verifier.service'
import type { SessionsService, CreatedSession } from './sessions.service'
import type { User } from '../users/user.entity'
import type { UsersService } from '../users/users.service'

const identity: GoogleIdentity = {
  sub: 'sub-1',
  email: 'me@example.com',
  name: 'Me',
  picture: 'https://example.com/me.png',
}

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 7,
    googleSub: 'sub-1',
    email: 'me@example.com',
    name: 'Me',
    picture: 'https://example.com/me.png',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeMocks() {
  const verifier = { verify: jest.fn() } as unknown as jest.Mocked<GoogleTokenVerifier>
  const usersService = {
    findOrCreateFromGoogle: jest.fn(),
    findById: jest.fn(),
  } as unknown as jest.Mocked<UsersService>
  const sessionsService = {
    create: jest.fn(),
    validate: jest.fn(),
    revoke: jest.fn(),
  } as unknown as jest.Mocked<SessionsService>
  const service = new AuthService(verifier, usersService, sessionsService, {
    allowedEmails: ['me@example.com'],
  })
  return { verifier, usersService, sessionsService, service }
}

describe('AuthService', () => {
  describe('loginWithGoogle', () => {
    it('creates a session for the user when the verified e-mail is allowlisted', async () => {
      const { verifier, usersService, sessionsService, service } = makeMocks()
      verifier.verify.mockResolvedValue(identity)
      usersService.findOrCreateFromGoogle.mockResolvedValue(fakeUser())
      const created: CreatedSession = {
        sessionToken: 'session-token',
        csrfToken: 'csrf-token',
        expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      }
      sessionsService.create.mockResolvedValue(created)

      const result = await service.loginWithGoogle('id-token')

      expect(verifier.verify).toHaveBeenCalledWith('id-token')
      expect(usersService.findOrCreateFromGoogle).toHaveBeenCalledWith(identity)
      expect(sessionsService.create).toHaveBeenCalledWith(7)
      expect(result).toBe(created)
    })

    it('rejects with 403, creating neither a user nor a session, when the e-mail is not allowlisted', async () => {
      const { verifier, usersService, sessionsService, service } = makeMocks()
      verifier.verify.mockResolvedValue({ ...identity, email: 'stranger@example.com' })

      await expect(service.loginWithGoogle('id-token')).rejects.toBeInstanceOf(
        ForbiddenException,
      )
      expect(usersService.findOrCreateFromGoogle).not.toHaveBeenCalled()
      expect(sessionsService.create).not.toHaveBeenCalled()
    })

    it('propagates a token verification failure without touching users or sessions', async () => {
      const { verifier, usersService, sessionsService, service } = makeMocks()
      verifier.verify.mockRejectedValue(new UnauthorizedException('Invalid Google ID token'))

      await expect(service.loginWithGoogle('forged')).rejects.toBeInstanceOf(
        UnauthorizedException,
      )
      expect(usersService.findOrCreateFromGoogle).not.toHaveBeenCalled()
      expect(sessionsService.create).not.toHaveBeenCalled()
    })
  })

  describe('getProfile', () => {
    it('returns the public profile of the signed-in user', async () => {
      const { usersService, service } = makeMocks()
      usersService.findById.mockResolvedValue(fakeUser())

      await expect(service.getProfile(7)).resolves.toEqual({
        id: 7,
        email: 'me@example.com',
        name: 'Me',
        picture: 'https://example.com/me.png',
      })
      expect(usersService.findById).toHaveBeenCalledWith(7)
    })

    it('rejects with 401 when the session points at a user that no longer exists', async () => {
      const { usersService, service } = makeMocks()
      usersService.findById.mockResolvedValue(null)

      await expect(service.getProfile(7)).rejects.toBeInstanceOf(UnauthorizedException)
    })
  })

  it('logout revokes the session identified by the token', async () => {
    const { sessionsService, service } = makeMocks()

    await service.logout('session-token')

    expect(sessionsService.revoke).toHaveBeenCalledWith('session-token')
  })
})

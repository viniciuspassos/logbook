import { UnauthorizedException } from '@nestjs/common'
import { AuthService } from './auth.service'
import type { PasswordHasherService } from './password-hasher.service'
import type { SessionsService, CreatedSession } from './sessions.service'

function makePasswordHasherMock() {
  return { hash: jest.fn(), verify: jest.fn() } as unknown as jest.Mocked<PasswordHasherService>
}

function makeSessionsServiceMock() {
  return {
    create: jest.fn(),
    validate: jest.fn(),
    revoke: jest.fn(),
  } as unknown as jest.Mocked<SessionsService>
}

const STORED_HASH = 'scrypt$16384$abcd$ef01'

describe('AuthService', () => {
  it('creates a session when the password matches the configured hash', async () => {
    const passwordHasher = makePasswordHasherMock()
    const sessionsService = makeSessionsServiceMock()
    passwordHasher.verify.mockResolvedValue(true)
    const created: CreatedSession = {
      sessionToken: 'session-token',
      csrfToken: 'csrf-token',
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    }
    sessionsService.create.mockResolvedValue(created)
    const service = new AuthService(passwordHasher, sessionsService, {
      authPasswordHash: STORED_HASH,
    })

    const result = await service.login('correct password')

    expect(passwordHasher.verify).toHaveBeenCalledWith('correct password', STORED_HASH)
    expect(result).toBe(created)
  })

  it('rejects a non-matching password with a generic UnauthorizedException', async () => {
    const passwordHasher = makePasswordHasherMock()
    const sessionsService = makeSessionsServiceMock()
    passwordHasher.verify.mockResolvedValue(false)
    const service = new AuthService(passwordHasher, sessionsService, {
      authPasswordHash: STORED_HASH,
    })

    await expect(service.login('wrong password')).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
    await expect(service.login('wrong password')).rejects.toThrow('Invalid credentials')
    expect(sessionsService.create).not.toHaveBeenCalled()
  })

  it('logout revokes the session identified by the token', async () => {
    const passwordHasher = makePasswordHasherMock()
    const sessionsService = makeSessionsServiceMock()
    const service = new AuthService(passwordHasher, sessionsService, {
      authPasswordHash: STORED_HASH,
    })

    await service.logout('session-token')

    expect(sessionsService.revoke).toHaveBeenCalledWith('session-token')
  })
})

import type { ConfigService } from '@nestjs/config'
import type { Request, Response } from 'express'
import { AuthController } from './auth.controller'
import type { AuthService } from './auth.service'
import type { LoginDto } from './dto/login.dto'
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from './cookies'

function makeAuthServiceMock() {
  return { login: jest.fn(), logout: jest.fn() } as unknown as jest.Mocked<AuthService>
}

function makeConfigServiceMock(cookieSecure = false) {
  return {
    getOrThrow: jest.fn().mockReturnValue({ cookieSecure }),
  } as unknown as jest.Mocked<ConfigService>
}

function makeResMock() {
  return { cookie: jest.fn(), clearCookie: jest.fn() } as unknown as jest.Mocked<Response>
}

describe('AuthController', () => {
  describe('login', () => {
    it('logs in via the service and sets the session + csrf cookies', async () => {
      const authService = makeAuthServiceMock()
      const created = {
        sessionToken: 'session-token',
        csrfToken: 'csrf-token',
        expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      }
      authService.login.mockResolvedValue(created)
      const controller = new AuthController(authService, makeConfigServiceMock())
      const res = makeResMock()
      const dto: LoginDto = { password: 'correct password' }

      const result = await controller.login(dto, res)

      expect(authService.login).toHaveBeenCalledWith('correct password')
      expect(res.cookie).toHaveBeenCalledWith(
        SESSION_COOKIE_NAME,
        'session-token',
        expect.objectContaining({ httpOnly: true }),
      )
      expect(res.cookie).toHaveBeenCalledWith(
        CSRF_COOKIE_NAME,
        'csrf-token',
        expect.objectContaining({ httpOnly: false }),
      )
      expect(result).toEqual({ status: 'ok' })
    })

    it('propagates a login failure without setting any cookie', async () => {
      const authService = makeAuthServiceMock()
      authService.login.mockRejectedValue(new Error('Invalid credentials'))
      const controller = new AuthController(authService, makeConfigServiceMock())
      const res = makeResMock()

      await expect(controller.login({ password: 'wrong' }, res)).rejects.toThrow(
        'Invalid credentials',
      )
      expect(res.cookie).not.toHaveBeenCalled()
    })
  })

  describe('logout', () => {
    it('revokes the session from the request cookie and clears both cookies', async () => {
      const authService = makeAuthServiceMock()
      const controller = new AuthController(authService, makeConfigServiceMock())
      const req = {
        cookies: { [SESSION_COOKIE_NAME]: 'session-token' },
      } as unknown as Request
      const res = makeResMock()

      const result = await controller.logout(req, res)

      expect(authService.logout).toHaveBeenCalledWith('session-token')
      expect(res.clearCookie).toHaveBeenCalledWith(SESSION_COOKIE_NAME, expect.any(Object))
      expect(res.clearCookie).toHaveBeenCalledWith(CSRF_COOKIE_NAME, expect.any(Object))
      expect(result).toEqual({ status: 'ok' })
    })

    it('is a no-op on the service when there is no session cookie to revoke', async () => {
      const authService = makeAuthServiceMock()
      const controller = new AuthController(authService, makeConfigServiceMock())
      const req = { cookies: {} } as unknown as Request
      const res = makeResMock()

      await controller.logout(req, res)

      expect(authService.logout).not.toHaveBeenCalled()
      expect(res.clearCookie).toHaveBeenCalledWith(SESSION_COOKIE_NAME, expect.any(Object))
    })
  })
})

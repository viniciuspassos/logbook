import type { ConfigService } from '@nestjs/config'
import type { Request, Response } from 'express'
import { AuthController } from './auth.controller'
import type { AuthService } from './auth.service'
import type { RequestWithSession } from './request-with-session'
import type { Session } from './session.entity'
import type { GoogleLoginDto } from './dto/google-login.dto'
import { GoogleAuthEnabledGuard } from './google-auth-enabled.guard'
import { GoogleLoginRequestGuard } from './google-login-request.guard'
import { IS_PUBLIC_KEY } from './public.decorator'
import { IS_SESSION_OPTIONAL_KEY } from './optional-session.decorator'
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from './cookies'

function makeAuthServiceMock() {
  return {
    loginWithGoogle: jest.fn(),
    getProfile: jest.fn(),
    logout: jest.fn(),
  } as unknown as jest.Mocked<AuthService>
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
  it('gates the Google sign-in route: flag guard first (404 when off), then the login-CSRF guard', () => {
    const guards = Reflect.getMetadata('__guards__', AuthController.prototype.loginWithGoogle)

    expect(guards).toEqual([GoogleAuthEnabledGuard, GoogleLoginRequestGuard])
  })

  describe('loginWithGoogle', () => {
    it('signs in via the service and sets the session + csrf cookies', async () => {
      const authService = makeAuthServiceMock()
      const created = {
        sessionToken: 'session-token',
        csrfToken: 'csrf-token',
        expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      }
      authService.loginWithGoogle.mockResolvedValue(created)
      const controller = new AuthController(authService, makeConfigServiceMock())
      const res = makeResMock()
      const dto: GoogleLoginDto = { idToken: 'id-token' }

      const result = await controller.loginWithGoogle(dto, res)

      expect(authService.loginWithGoogle).toHaveBeenCalledWith('id-token')
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

    it('propagates a sign-in failure without setting any cookie', async () => {
      const authService = makeAuthServiceMock()
      authService.loginWithGoogle.mockRejectedValue(new Error('Invalid Google ID token'))
      const controller = new AuthController(authService, makeConfigServiceMock())
      const res = makeResMock()

      await expect(controller.loginWithGoogle({ idToken: 'bad' }, res)).rejects.toThrow(
        'Invalid Google ID token',
      )
      expect(res.cookie).not.toHaveBeenCalled()
    })
  })

  describe('me', () => {
    function makeSession(): Session {
      return {
        id: 1,
        userId: 7,
        tokenHash: 'h',
        csrfToken: 'csrf-token',
        expiresAt: new Date('2026-08-01T00:00:00.000Z'),
        createdAt: new Date(),
      }
    }

    it("returns the signed-in user's profile", async () => {
      const authService = makeAuthServiceMock()
      const profile = { id: 7, email: 'me@example.com', name: 'Me', picture: null }
      authService.getProfile.mockResolvedValue(profile)
      const controller = new AuthController(authService, makeConfigServiceMock())
      const req = { cookies: {}, session: makeSession() } as unknown as RequestWithSession

      await expect(controller.me(7, req, makeResMock())).resolves.toBe(profile)
      expect(authService.getProfile).toHaveBeenCalledWith(7)
    })

    it('re-issues both session cookies so the client resyncs at least once per app launch', async () => {
      const authService = makeAuthServiceMock()
      authService.getProfile.mockResolvedValue({ id: 7, email: 'e', name: null, picture: null })
      const controller = new AuthController(authService, makeConfigServiceMock(true))
      const session = makeSession()
      const req = {
        cookies: { [SESSION_COOKIE_NAME]: 'session-token' },
        session,
      } as unknown as RequestWithSession
      const res = makeResMock()

      await controller.me(7, req, res)

      expect(res.cookie).toHaveBeenCalledWith(
        SESSION_COOKIE_NAME,
        'session-token',
        expect.objectContaining({ httpOnly: true, expires: session.expiresAt, secure: true }),
      )
      expect(res.cookie).toHaveBeenCalledWith(
        CSRF_COOKIE_NAME,
        'csrf-token',
        expect.objectContaining({ httpOnly: false, expires: session.expiresAt }),
      )
    })

    it('sets no cookie when the request carries no session cookie to echo back', async () => {
      const authService = makeAuthServiceMock()
      authService.getProfile.mockResolvedValue({ id: 7, email: 'e', name: null, picture: null })
      const controller = new AuthController(authService, makeConfigServiceMock())
      const req = { cookies: {}, session: makeSession() } as unknown as RequestWithSession
      const res = makeResMock()

      await controller.me(7, req, res)

      expect(res.cookie).not.toHaveBeenCalled()
    })
  })

  describe('logout', () => {
    it('is optional-session (works without a valid session, CSRF enforced when one exists) and not fully public', () => {
      expect(
        Reflect.getMetadata(IS_SESSION_OPTIONAL_KEY, AuthController.prototype.logout),
      ).toBe(true)
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, AuthController.prototype.logout)).toBeUndefined()
    })

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

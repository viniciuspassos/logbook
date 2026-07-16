import { UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import type { ConfigService } from '@nestjs/config'
import type { Request, Response } from 'express'
import { SessionAuthGuard } from './session-auth.guard'
import type { SessionsService } from './sessions.service'
import type { Session } from './session.entity'
import { SESSION_COOKIE_NAME, CSRF_COOKIE_NAME } from './cookies'

function makeSessionsServiceMock() {
  return {
    create: jest.fn(),
    validate: jest.fn(),
    revoke: jest.fn(),
  } as unknown as jest.Mocked<SessionsService>
}

function makeReflectorMock(isPublic: boolean) {
  return { getAllAndOverride: jest.fn().mockReturnValue(isPublic) } as unknown as jest.Mocked<Reflector>
}

function makeConfigServiceMock(cookieSecure: boolean) {
  return {
    getOrThrow: jest.fn().mockReturnValue({ cookieSecure }),
  } as unknown as jest.Mocked<ConfigService>
}

function makeContext(req: Partial<Request>, res: Partial<Response> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext
}

function fakeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 1,
    tokenHash: 'hash',
    csrfToken: 'csrf-token',
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    createdAt: new Date(),
    ...overrides,
  }
}

describe('SessionAuthGuard', () => {
  it('allows a request through unconditionally when the route is @Public()', async () => {
    const sessionsService = makeSessionsServiceMock()
    const guard = new SessionAuthGuard(
      sessionsService,
      makeReflectorMock(true),
      makeConfigServiceMock(false),
    )
    const context = makeContext({})

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(sessionsService.validate).not.toHaveBeenCalled()
  })

  it('throws UnauthorizedException when no session cookie is present', async () => {
    const sessionsService = makeSessionsServiceMock()
    const guard = new SessionAuthGuard(
      sessionsService,
      makeReflectorMock(false),
      makeConfigServiceMock(false),
    )
    const context = makeContext({ cookies: {} } as Partial<Request>)

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('throws UnauthorizedException when the session cookie does not match a valid session', async () => {
    const sessionsService = makeSessionsServiceMock()
    sessionsService.validate.mockResolvedValue(null)
    const guard = new SessionAuthGuard(
      sessionsService,
      makeReflectorMock(false),
      makeConfigServiceMock(false),
    )
    const context = makeContext({ cookies: { [SESSION_COOKIE_NAME]: 'stale-token' } } as Partial<Request>)

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('attaches the resolved session to the request and allows the request through', async () => {
    const sessionsService = makeSessionsServiceMock()
    const session = fakeSession()
    sessionsService.validate.mockResolvedValue(session)
    const guard = new SessionAuthGuard(
      sessionsService,
      makeReflectorMock(false),
      makeConfigServiceMock(false),
    )
    const req = { cookies: { [SESSION_COOKIE_NAME]: 'valid-token' } } as unknown as Request &
      Record<string, unknown>
    const res = { cookie: jest.fn() } as unknown as Response
    const context = makeContext(req, res)

    const result = await guard.canActivate(context)

    expect(result).toBe(true)
    expect((req as unknown as { session: Session }).session).toBe(session)
    expect(sessionsService.validate).toHaveBeenCalledWith('valid-token')
  })

  it('mirrors the (possibly renewed) session expiry onto both cookies on every authenticated request', async () => {
    const sessionsService = makeSessionsServiceMock()
    const session = fakeSession({ csrfToken: 'fresh-csrf' })
    sessionsService.validate.mockResolvedValue(session)
    const guard = new SessionAuthGuard(
      sessionsService,
      makeReflectorMock(false),
      makeConfigServiceMock(true),
    )
    const req = { cookies: { [SESSION_COOKIE_NAME]: 'valid-token' } } as unknown as Request
    const res = { cookie: jest.fn() } as unknown as jest.Mocked<Response>
    const context = makeContext(req, res)

    await guard.canActivate(context)

    expect(res.cookie).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      'valid-token',
      expect.objectContaining({ expires: session.expiresAt, secure: true }),
    )
    expect(res.cookie).toHaveBeenCalledWith(
      CSRF_COOKIE_NAME,
      'fresh-csrf',
      expect.objectContaining({ expires: session.expiresAt, secure: true }),
    )
  })
})

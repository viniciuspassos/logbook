import { ForbiddenException, type ExecutionContext } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { CsrfGuard } from './csrf.guard'
import { CSRF_HEADER_NAME } from './cookies'
import type { RequestWithSession } from './request-with-session'
import type { Session } from './session.entity'

function makeReflectorMock(isPublic: boolean) {
  return { getAllAndOverride: jest.fn().mockReturnValue(isPublic) } as unknown as jest.Mocked<Reflector>
}

function makeContext(req: Partial<RequestWithSession>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext
}

function fakeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 1,
    tokenHash: 'hash',
    csrfToken: 'expected-csrf-token',
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    createdAt: new Date(),
    ...overrides,
  }
}

describe('CsrfGuard', () => {
  it('allows the request through unconditionally when the route is @Public()', () => {
    const guard = new CsrfGuard(makeReflectorMock(true))
    const context = makeContext({ method: 'POST' } as Partial<Request>)

    expect(guard.canActivate(context)).toBe(true)
  })

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'allows a %s request through without checking the CSRF header',
    (method) => {
      const guard = new CsrfGuard(makeReflectorMock(false))
      const context = makeContext({ method } as Partial<Request>)

      expect(guard.canActivate(context)).toBe(true)
    },
  )

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'allows a %s request through when the header matches the session csrf token',
    (method) => {
      const guard = new CsrfGuard(makeReflectorMock(false))
      const context = makeContext({
        method,
        session: fakeSession(),
        headers: { [CSRF_HEADER_NAME]: 'expected-csrf-token' },
      } as unknown as Partial<Request>)

      expect(guard.canActivate(context)).toBe(true)
    },
  )

  it('rejects a mutating request with a missing CSRF header', () => {
    const guard = new CsrfGuard(makeReflectorMock(false))
    const context = makeContext({
      method: 'POST',
      session: fakeSession(),
      headers: {},
    } as unknown as Partial<Request>)

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException)
  })

  it('rejects a mutating request with a CSRF header that does not match the session', () => {
    const guard = new CsrfGuard(makeReflectorMock(false))
    const context = makeContext({
      method: 'POST',
      session: fakeSession(),
      headers: { [CSRF_HEADER_NAME]: 'wrong-token' },
    } as unknown as Partial<Request>)

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException)
  })

  it('fails closed if no session is attached to the request (guard order safety net)', () => {
    const guard = new CsrfGuard(makeReflectorMock(false))
    const context = makeContext({
      method: 'POST',
      headers: { [CSRF_HEADER_NAME]: 'anything' },
    } as unknown as Partial<Request>)

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException)
  })
})

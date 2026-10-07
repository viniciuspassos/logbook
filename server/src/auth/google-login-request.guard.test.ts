import { ForbiddenException, type ExecutionContext } from '@nestjs/common'
import {
  GoogleLoginRequestGuard,
  LOGIN_CLIENT_HEADER_NAME,
  LOGIN_CLIENT_HEADER_VALUE,
} from './google-login-request.guard'

function contextWith(headers: Record<string, string | undefined>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext
}

describe('GoogleLoginRequestGuard', () => {
  const guard = new GoogleLoginRequestGuard()

  it('uses the documented header name and value', () => {
    expect(LOGIN_CLIENT_HEADER_NAME).toBe('x-logbook-client')
    expect(LOGIN_CLIENT_HEADER_VALUE).toBe('web')
  })

  it('lets a request carrying the client header through', () => {
    expect(guard.canActivate(contextWith({ [LOGIN_CLIENT_HEADER_NAME]: 'web' }))).toBe(true)
  })

  it('rejects a request without the client header with a generic 403', () => {
    expect(() => guard.canActivate(contextWith({}))).toThrow(ForbiddenException)
    expect(() => guard.canActivate(contextWith({}))).toThrow('Forbidden')
  })

  it.each(['mobile', 'WEB', '', 'web '])('rejects the client header value %p with 403', (value) => {
    expect(() =>
      guard.canActivate(contextWith({ [LOGIN_CLIENT_HEADER_NAME]: value })),
    ).toThrow(ForbiddenException)
  })
})

import {
  ForbiddenException,
  UnsupportedMediaTypeException,
  type ExecutionContext,
} from '@nestjs/common'
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

const goodHeaders = {
  'content-type': 'application/json',
  [LOGIN_CLIENT_HEADER_NAME]: LOGIN_CLIENT_HEADER_VALUE,
}

describe('GoogleLoginRequestGuard', () => {
  const guard = new GoogleLoginRequestGuard()

  it('uses the documented header name and value', () => {
    expect(LOGIN_CLIENT_HEADER_NAME).toBe('x-logbook-client')
    expect(LOGIN_CLIENT_HEADER_VALUE).toBe('web')
  })

  it('lets a JSON request carrying the client header through', () => {
    expect(guard.canActivate(contextWith(goodHeaders))).toBe(true)
  })

  it.each(['application/json; charset=utf-8', 'Application/JSON', 'application/json;charset=UTF-8'])(
    'accepts the JSON content type %p',
    (contentType) => {
      expect(guard.canActivate(contextWith({ ...goodHeaders, 'content-type': contentType }))).toBe(
        true,
      )
    },
  )

  it.each([
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    'text/plain',
    'application/jsonp',
    'application/json-seq',
  ])('rejects the non-JSON content type %p with 415 before anything else', (contentType) => {
    // Even with no client header at all: the content type is checked first.
    expect(() => guard.canActivate(contextWith({ 'content-type': contentType }))).toThrow(
      UnsupportedMediaTypeException,
    )
  })

  it('rejects a request with no content type with 415', () => {
    expect(() =>
      guard.canActivate(contextWith({ [LOGIN_CLIENT_HEADER_NAME]: LOGIN_CLIENT_HEADER_VALUE })),
    ).toThrow(UnsupportedMediaTypeException)
  })

  it('rejects a request without the client header with a generic 403', () => {
    expect(() => guard.canActivate(contextWith({ 'content-type': 'application/json' }))).toThrow(
      ForbiddenException,
    )
    expect(() => guard.canActivate(contextWith({ 'content-type': 'application/json' }))).toThrow(
      'Forbidden',
    )
  })

  it.each(['mobile', 'WEB', '', 'web '])('rejects the client header value %p with 403', (value) => {
    expect(() =>
      guard.canActivate(contextWith({ ...goodHeaders, [LOGIN_CLIENT_HEADER_NAME]: value })),
    ).toThrow(ForbiddenException)
  })

  it('rejects a browser-declared cross-site request with 403, even when everything else is right', () => {
    expect(() =>
      guard.canActivate(contextWith({ ...goodHeaders, 'sec-fetch-site': 'cross-site' })),
    ).toThrow(ForbiddenException)
  })

  it.each(['same-origin', 'same-site', 'none'])(
    'allows Sec-Fetch-Site: %s',
    (site) => {
      expect(guard.canActivate(contextWith({ ...goodHeaders, 'sec-fetch-site': site }))).toBe(true)
    },
  )
})

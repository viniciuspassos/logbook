import type { Request, Response } from 'express'
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  SESSION_COOKIE_NAME,
  clearSessionCookies,
  getCsrfHeaderToken,
  getSessionCookie,
  setSessionCookies,
} from './cookies'

function makeResMock() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as jest.Mocked<Response>
}

describe('setSessionCookies', () => {
  const payload = {
    sessionToken: 'session-token-value',
    csrfToken: 'csrf-token-value',
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
  }

  it('sets an httpOnly cookie for the session token', () => {
    const res = makeResMock()

    setSessionCookies(res, payload, { secure: false })

    expect(res.cookie).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      payload.sessionToken,
      expect.objectContaining({
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
        expires: payload.expiresAt,
      }),
    )
  })

  it('sets a JS-readable (non-httpOnly) cookie for the CSRF token', () => {
    const res = makeResMock()

    setSessionCookies(res, payload, { secure: false })

    expect(res.cookie).toHaveBeenCalledWith(
      CSRF_COOKIE_NAME,
      payload.csrfToken,
      expect.objectContaining({
        httpOnly: false,
        secure: false,
        sameSite: 'lax',
        path: '/',
        expires: payload.expiresAt,
      }),
    )
  })

  it('marks both cookies Secure when cookieSecure is true', () => {
    const res = makeResMock()

    setSessionCookies(res, payload, { secure: true })

    expect(res.cookie).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      payload.sessionToken,
      expect.objectContaining({ secure: true }),
    )
    expect(res.cookie).toHaveBeenCalledWith(
      CSRF_COOKIE_NAME,
      payload.csrfToken,
      expect.objectContaining({ secure: true }),
    )
  })
})

describe('clearSessionCookies', () => {
  it('clears both the session and csrf cookies', () => {
    const res = makeResMock()

    clearSessionCookies(res, { secure: false })

    expect(res.clearCookie).toHaveBeenCalledWith(SESSION_COOKIE_NAME, expect.any(Object))
    expect(res.clearCookie).toHaveBeenCalledWith(CSRF_COOKIE_NAME, expect.any(Object))
  })
})

describe('getSessionCookie', () => {
  it('returns the session cookie value when present', () => {
    const req = { cookies: { [SESSION_COOKIE_NAME]: 'abc123' } } as unknown as Request

    expect(getSessionCookie(req)).toBe('abc123')
  })

  it('returns undefined when the cookie is absent', () => {
    const req = { cookies: {} } as unknown as Request

    expect(getSessionCookie(req)).toBeUndefined()
  })

  it('returns undefined when cookie-parser has not populated req.cookies', () => {
    const req = {} as unknown as Request

    expect(getSessionCookie(req)).toBeUndefined()
  })
})

describe('getCsrfHeaderToken', () => {
  it('returns the header value when it is a single string', () => {
    const req = { headers: { [CSRF_HEADER_NAME]: 'header-token' } } as unknown as Request

    expect(getCsrfHeaderToken(req)).toBe('header-token')
  })

  it('returns undefined when the header is missing', () => {
    const req = { headers: {} } as unknown as Request

    expect(getCsrfHeaderToken(req)).toBeUndefined()
  })

  it('returns undefined when the header was sent multiple times (array)', () => {
    const req = { headers: { [CSRF_HEADER_NAME]: ['a', 'b'] } } as unknown as Request

    expect(getCsrfHeaderToken(req)).toBeUndefined()
  })
})

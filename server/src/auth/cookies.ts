import type { CookieOptions, Request, Response } from 'express'

export const SESSION_COOKIE_NAME = 'logbook_session'
export const CSRF_COOKIE_NAME = 'logbook_csrf'
/** Client must echo the CSRF cookie's value back in this header on mutating requests. */
export const CSRF_HEADER_NAME = 'x-csrf-token'

export interface CookieSecurityOptions {
  /** Mirrors AppConfig.cookieSecure — true outside local/dev HTTP. */
  secure: boolean
}

export interface SessionCookiePayload {
  sessionToken: string
  csrfToken: string
  expiresAt: Date
}

/**
 * Issues (or refreshes, on renewal — see SessionAuthGuard) the two cookies
 * that back a session:
 *  - `logbook_session`: httpOnly, unreadable from JS — this is what makes
 *    the cookie unexfiltratable by an XSS payload.
 *  - `logbook_csrf`: deliberately NOT httpOnly, so the frontend can read it
 *    and echo it back in the X-CSRF-Token header (double-submit pattern —
 *    see csrf.guard.ts for why SameSite alone isn't treated as sufficient).
 * Both share the session's expiry so the browser never holds a cookie the
 * server has already forgotten.
 */
export function setSessionCookies(
  res: Response,
  payload: SessionCookiePayload,
  options: CookieSecurityOptions,
): void {
  const shared: CookieOptions = {
    secure: options.secure,
    sameSite: 'lax',
    path: '/',
    expires: payload.expiresAt,
  }
  res.cookie(SESSION_COOKIE_NAME, payload.sessionToken, { ...shared, httpOnly: true })
  res.cookie(CSRF_COOKIE_NAME, payload.csrfToken, { ...shared, httpOnly: false })
}

/** Clears both cookies on logout. Attribute values (path/sameSite/secure) must match how they were set. */
export function clearSessionCookies(res: Response, options: CookieSecurityOptions): void {
  const shared: CookieOptions = { secure: options.secure, sameSite: 'lax', path: '/' }
  res.clearCookie(SESSION_COOKIE_NAME, { ...shared, httpOnly: true })
  res.clearCookie(CSRF_COOKIE_NAME, { ...shared, httpOnly: false })
}

/** Reads the raw session token from the request cookies, narrowing cookie-parser's loose typing. */
export function getSessionCookie(req: Request): string | undefined {
  return readStringCookie(req, SESSION_COOKIE_NAME)
}

/** Reads the CSRF token the client echoed back in the request header. */
export function getCsrfHeaderToken(req: Request): string | undefined {
  const value: unknown = req.headers[CSRF_HEADER_NAME]
  return typeof value === 'string' ? value : undefined
}

function readStringCookie(req: Request, name: string): string | undefined {
  const cookies: unknown = req.cookies
  if (typeof cookies !== 'object' || cookies === null) {
    return undefined
  }
  const value: unknown = (cookies as Record<string, unknown>)[name]
  return typeof value === 'string' ? value : undefined
}

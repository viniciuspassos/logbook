/**
 * Reads the double-submit CSRF cookie the backend sets (`logbook_csrf`,
 * server/src/auth/cookies.ts) so it can be echoed back in the
 * `x-csrf-token` header on mutating requests (see httpClient.ts). Kept
 * separate from httpClient so the cookie-parsing logic has its own focused
 * tests — `document.cookie` is a single opaque string and easy to get wrong.
 */

export const CSRF_COOKIE_NAME = 'logbook_csrf'
export const CSRF_HEADER_NAME = 'x-csrf-token'

/** The named cookie's value, or `null` if absent or `document` doesn't exist. */
export function readCookie(name: string): string | null {
  if (typeof document === 'undefined' || !document.cookie) return null

  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).trim()
    if (key === name) {
      return decodeURIComponent(part.slice(eq + 1).trim())
    }
  }
  return null
}

/** The current CSRF token, or `null` before the first login. */
export function readCsrfToken(): string | null {
  return readCookie(CSRF_COOKIE_NAME)
}

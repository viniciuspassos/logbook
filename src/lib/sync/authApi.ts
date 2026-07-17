import { syncRequest } from './httpClient.ts'

export interface AuthStatusResponse {
  status: 'ok'
}

/**
 * POST /auth/login. `@Public()` on the server, so no CSRF header is needed
 * for this call — the CSRF cookie doesn't exist yet until this succeeds.
 * Throws SyncAuthError (wrong password -> 401, see AuthService) or
 * SyncNetworkError; callers degrade to the offline/local-only path on any
 * failure, same as every other browser-API wrapper in this app.
 */
export function login(password: string): Promise<AuthStatusResponse> {
  return syncRequest<AuthStatusResponse>('/auth/login', {
    method: 'POST',
    body: { password },
  })
}

/** POST /auth/logout. Clears both session cookies server-side on success. */
export function logout(): Promise<AuthStatusResponse> {
  return syncRequest<AuthStatusResponse>('/auth/logout', { method: 'POST' })
}

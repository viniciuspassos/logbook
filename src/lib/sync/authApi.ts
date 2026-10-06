import { syncRequest } from './httpClient.ts'
import { SyncHttpError } from './errors.ts'
import type { AuthProfile } from '../../types/auth.ts'

export interface AuthStatusResponse {
  status: 'ok'
}

function isAuthProfile(value: unknown): value is AuthProfile {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  const hasId = typeof candidate.id === 'string' || typeof candidate.id === 'number'
  const nullableString = (field: unknown) => field === null || typeof field === 'string'
  return (
    hasId &&
    typeof candidate.email === 'string' &&
    nullableString(candidate.name) &&
    nullableString(candidate.picture)
  )
}

/**
 * POST /auth/google with the Google ID token. `@Public()` on the server, so
 * no CSRF header is needed — the CSRF cookie doesn't exist until this
 * succeeds. Throws SyncAuthError (401 token rejected, 403 account not on the
 * allowlist) or SyncNetworkError; callers degrade to the gate's error
 * message, never block local capture.
 */
export function loginWithGoogle(idToken: string): Promise<AuthStatusResponse> {
  return syncRequest<AuthStatusResponse>('/auth/google', {
    method: 'POST',
    body: { idToken },
  })
}

/**
 * GET /auth/me: who the session cookie belongs to. The only "is this browser
 * signed in?" probe there is. 401 -> SyncAuthError. The body is validated
 * rather than trusted, since it ends up cached locally and shown in Settings.
 */
export async function getMe(signal?: AbortSignal): Promise<AuthProfile> {
  const body = await syncRequest<unknown>('/auth/me', { signal })
  if (!isAuthProfile(body)) {
    throw new SyncHttpError(200, body, 'Unexpected response from /auth/me.')
  }
  return body
}

/** POST /auth/logout. Clears both session cookies server-side on success. */
export function logout(): Promise<AuthStatusResponse> {
  return syncRequest<AuthStatusResponse>('/auth/logout', { method: 'POST' })
}

import { getApiBaseUrl } from './config.ts'

/**
 * Backend-presence detection. There is no session-status endpoint (auth
 * state is only ever discovered by making a request and handling 401/403 —
 * see authApi.ts), but `GET /health` is `@Public()` and always answers when
 * the process is up, so the outbox runner (outboxRunner.ts) uses it to
 * decide whether a sync pass is even worth attempting.
 */
export async function isBackendReachable(signal?: AbortSignal): Promise<boolean> {
  if (typeof fetch === 'undefined') return false
  try {
    const response = await fetch(`${getApiBaseUrl()}/health`, {
      credentials: 'include',
      signal,
    })
    return response.ok
  } catch {
    return false
  }
}

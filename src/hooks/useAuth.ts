import { useCallback, useState } from 'react'
import { login as loginRequest, logout as logoutRequest } from '../lib/sync/authApi.ts'
import { SyncAuthError, SyncNetworkError } from '../lib/sync/errors.ts'
import { drainOutbox } from '../lib/sync/outboxRunner.ts'

/**
 * Owns whether the user is signed in to the sync backend (see
 * `src/lib/sync/authApi.ts`) — a distinct concern from `useSyncOutbox`
 * (background drain scheduling) and `useEntryAttachments` (one entry's
 * gallery), so it's its own hook per CLAUDE.md's state-composition rule.
 *
 * There is no session-status endpoint (`health.ts` only proves the backend
 * is reachable, not that this browser has a valid cookie), so `state` starts
 * `'unknown'` and is only ever learned two ways: the user explicitly calls
 * `login`/`logout`, or a sync attempt elsewhere in the app discovers the
 * answer as a side effect and reports it back via `noteAuthRequired` (a 401)
 * or `noteAuthConfirmed` (a mutating call that actually went through) — see
 * useSyncOutbox.ts and useEntryAttachments.ts, which both drain the outbox
 * and forward what that drain found out about the session.
 *
 * Per CLAUDE.md's Browser AI/sync degradation rule, none of this may ever
 * block entry capture: login failures (wrong password *or* offline) just
 * report a status message, and logout always lands on `'signedOut'` locally
 * even if the network request itself failed, rather than leaving the UI
 * stuck retrying.
 */

export type AuthState = 'unknown' | 'signedIn' | 'signedOut'

export interface UseAuthResult {
  state: AuthState
  pending: boolean
  error: string | null
  /** Resolves to whether sign-in succeeded; never rejects. */
  login: (password: string) => Promise<boolean>
  logout: () => Promise<void>
  /** Call when a sync attempt elsewhere discovers the session is gone (401/403). */
  noteAuthRequired: () => void
  /** Call when a sync attempt elsewhere discovers the session is valid (a mutating call succeeded). */
  noteAuthConfirmed: () => void
  clearError: () => void
}

function messageForLoginError(error: unknown): string {
  if (error instanceof SyncAuthError) return 'Incorrect password.'
  if (error instanceof SyncNetworkError) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong.'
}

export function useAuth(): UseAuthResult {
  const [state, setState] = useState<AuthState>('unknown')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const login = useCallback(async (password: string): Promise<boolean> => {
    setPending(true)
    setError(null)
    try {
      await loginRequest(password)
      setState('signedIn')
      // Anything the outbox queued while signed out can now go through.
      void drainOutbox()
      return true
    } catch (err) {
      // A wrong password is a confirmed "not signed in"; a network failure
      // tells us nothing about the session, so the state is left alone.
      if (err instanceof SyncAuthError) setState('signedOut')
      setError(messageForLoginError(err))
      return false
    } finally {
      setPending(false)
    }
  }, [])

  const logout = useCallback(async (): Promise<void> => {
    setPending(true)
    setError(null)
    try {
      await logoutRequest()
    } catch {
      // Best-effort, same as every other browser-API wrapper in this app:
      // the user asked to sign out, so the UI reflects that locally even if
      // the request to clear the server-side cookie didn't land.
    } finally {
      setState('signedOut')
      setPending(false)
    }
  }, [])

  const noteAuthRequired = useCallback(() => setState('signedOut'), [])
  const noteAuthConfirmed = useCallback(() => setState('signedIn'), [])
  const clearError = useCallback(() => setError(null), [])

  return { state, pending, error, login, logout, noteAuthRequired, noteAuthConfirmed, clearError }
}

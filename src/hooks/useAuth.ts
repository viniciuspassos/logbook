import { useCallback, useEffect, useState } from 'react'
import { disableGoogleAutoSelect } from '../lib/auth/googleIdentity.ts'
import { shouldUseMockData } from '../lib/config/mockData.ts'
import { clearCachedIdentity, getCachedIdentity, putCachedIdentity } from '../lib/db/identityStore.ts'
import { getMe, loginWithGoogle, logout as logoutRequest } from '../lib/sync/authApi.ts'
import { SyncAuthError, SyncNetworkError } from '../lib/sync/errors.ts'
import { drainOutbox } from '../lib/sync/outboxRunner.ts'
import type { AuthProfile } from '../types/auth.ts'

/**
 * Owns who is signed in (Sign in with Google, #122) — a distinct concern from
 * `useSyncOutbox` (background drain scheduling) and `useEntryAttachments`
 * (one entry's gallery), so it's its own hook per CLAUDE.md's state-composition
 * rule. `App.tsx` gates on `state`: `'signedOut'` shows the login screen.
 *
 * The gate is mandatory but never an offline lock-out. `state` resolves on
 * mount from two sources:
 *   1. the profile cached in IndexedDB by the last successful sign-in
 *      (`identityStore`) — if there is one the app opens immediately, even
 *      with no signal, so a signed-in user on a mountain can still log;
 *   2. `GET /auth/me`, when the backend is reachable. A 401 there means the
 *      session is gone, so the gate comes back. That never touches local
 *      entries or the outbox: only the way into the app changes, and the
 *      cached identity is kept so the app still opens offline. The cache is
 *      cleared only by an explicit `logout`.
 * The very first sign-in needs the network (unavoidable); with neither a
 * cached identity nor a reachable backend, the gate is shown.
 *
 * Under `npm run dev:mocked` (sample data, no backend) the gate is skipped.
 */

export type AuthState = 'loading' | 'signedIn' | 'signedOut'

export interface UseAuthResult {
  state: AuthState
  /** The signed-in account, when known. */
  profile: AuthProfile | null
  pending: boolean
  error: string | null
  /** Exchanges a Google ID token for a session. Resolves to whether it succeeded; never rejects. */
  signInWithGoogle: (idToken: string) => Promise<boolean>
  logout: () => Promise<void>
  /** Call when a sync attempt elsewhere discovers the session is gone (401/403). */
  noteAuthRequired: () => void
  clearError: () => void
}

interface Resolved {
  state: AuthState
  profile: AuthProfile | null
}

function messageForSignInError(error: unknown): string {
  if (error instanceof SyncAuthError) {
    return error.status === 403
      ? "This Google account isn't allowed to use this Logbook."
      : 'Sign-in expired. Try again.'
  }
  if (error instanceof SyncNetworkError) {
    return "Couldn't reach the Logbook server. Check your connection and try again."
  }
  return 'Something went wrong. Try again.'
}

/** What a failed `GET /auth/me` means: only a 401/403 revokes access; anything else keeps the cache. */
function outcomeAfterFailedCheck(error: unknown, cached: AuthProfile | null): Resolved {
  if (cached && !(error instanceof SyncAuthError)) return { state: 'signedIn', profile: cached }
  return { state: 'signedOut', profile: null }
}

async function restoreSession(signal: AbortSignal, apply: (next: Resolved) => void): Promise<void> {
  const cached = await getCachedIdentity()
  if (cached) apply({ state: 'signedIn', profile: cached })
  try {
    const profile = await getMe(signal)
    await putCachedIdentity(profile)
    apply({ state: 'signedIn', profile })
  } catch (error) {
    apply(outcomeAfterFailedCheck(error, cached))
  }
}

export function useAuth(): UseAuthResult {
  const [state, setState] = useState<AuthState>(() => (shouldUseMockData() ? 'signedIn' : 'loading'))
  const [profile, setProfile] = useState<AuthProfile | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (shouldUseMockData()) return
    const controller = new AbortController()
    void restoreSession(controller.signal, (next) => {
      if (controller.signal.aborted) return
      setState(next.state)
      setProfile(next.profile)
    })
    return () => controller.abort()
  }, [])

  const signInWithGoogle = useCallback(async (idToken: string): Promise<boolean> => {
    setPending(true)
    setError(null)
    try {
      await loginWithGoogle(idToken)
      const me = await getMe()
      await putCachedIdentity(me)
      setProfile(me)
      setState('signedIn')
      // Anything the outbox queued while signed out can now go through.
      void drainOutbox()
      return true
    } catch (err) {
      setError(messageForSignInError(err))
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
      // Best-effort: the user asked to sign out, so the UI reflects that
      // locally even if the request to clear the server-side cookie didn't land.
    } finally {
      await clearCachedIdentity()
      disableGoogleAutoSelect()
      setProfile(null)
      setState('signedOut')
      setPending(false)
    }
  }, [])

  const noteAuthRequired = useCallback(() => setState('signedOut'), [])
  const clearError = useCallback(() => setError(null), [])

  return { state, profile, pending, error, signInWithGoogle, logout, noteAuthRequired, clearError }
}

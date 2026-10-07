import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { useAuthConfig } from './useAuthConfig.ts'
import { useRetryWhileActive } from './useRetryWhileActive.ts'
import type { AuthMode } from '../lib/auth/authConfig.ts'
import {
  LOADING,
  SIGNED_OUT,
  STARTUP_TIMEOUT_MS,
  UnsyncedItemsError,
  isVerified,
  restoreSession,
  signInWithIdToken,
  signOut,
  startupFallback,
  verifiedSession,
  verifySession,
} from '../lib/auth/sessionFlows.ts'
import { SyncAuthError, SyncHttpError, SyncNetworkError } from '../lib/sync/errors.ts'
import { drainOutbox, setDrainsAllowed } from '../lib/sync/outboxRunner.ts'
import type { AuthProfile, AuthState, Session } from '../types/auth.ts'

export type { AuthState } from '../types/auth.ts'

/**
 * Owns who is signed in (Sign in with Google, #122); the decisions live in
 * `sessionFlows.ts`. The server picks the mode (`useAuthConfig`): under `none`
 * / `unknown` the session is simply local (no gate, banner, `/auth/me` or
 * drains); `dev:mocked` skips it all. Rules: see docs/ARCHITECTURE.md.
 */

export interface UseAuthOptions {
  /** This device's data was wiped, so in-memory lists must reload. Awaited before the new session shows. */
  onLocalDataReset?: () => void | Promise<void>
}

export interface UseAuthResult {
  mode: AuthMode
  googleClientId: string | null
  state: AuthState
  profile: AuthProfile | null
  /** Open on a cached identity or local entries, not yet confirmed by the server. */
  unverified: boolean
  /** A background request found the session gone; show a non-blocking "sign in again". */
  needsSignIn: boolean
  /** Set when a different account signed in and this device's previous entries were removed. */
  notice: string | null
  pending: boolean
  error: string | null
  /** After a refused sign-out: how many entries can never sync and would be lost (0 when there is no such offer). */
  unsyncedCount: number
  /** Exchanges a Google ID token for a session. Resolves to whether `/auth/google` accepted it; never rejects. */
  signInWithGoogle: (idToken: string) => Promise<boolean>
  /** Needs a connection: syncs first, then wipes this device. Failures land in `error`. */
  logout: () => Promise<void>
  /** Signs out anyway, discarding the entries that can never sync (offered after a refused `logout`). */
  discardUnsyncedAndLogout: () => Promise<void>
  noteSynced: () => void
  /** Call when a background request discovers the session is gone (a 401). Ignored outside `google` mode. */
  noteAuthRequired: () => void
  dismissSignInPrompt: () => void
  dismissNotice: () => void
  clearError: () => void
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
  if (error instanceof SyncHttpError) {
    // The server turned Google off after this screen asked about it.
    if (error.status === 404) return 'Google sign-in is turned off on this server.'
    return error.status >= 500
      ? 'The Logbook server had a problem. Try again in a moment.'
      : "Sign-in didn't go through. Try again."
  }
  return 'Something went wrong. Try again.'
}

/** Startup check; a slow one opens a known device unverified rather than leaving the splash up. */
function useRestoreOnMount(
  enabled: boolean,
  applySession: (session: Session) => Promise<void>,
  setSession: Dispatch<SetStateAction<Session>>,
  restoreRef: MutableRefObject<AbortController | null>,
) {
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    restoreRef.current = controller
    const apply = (next: Session) => {
      if (!controller.signal.aborted) void applySession(next)
    }
    // Only fills in a startup that is still waiting; never overwrites a real
    // answer. A device we don't know (nothing cached, nothing local) keeps waiting.
    const settleIfLoading = (next: Session | null) => {
      if (next && !controller.signal.aborted) setSession((cur) => (cur.state === 'loading' ? next : cur))
    }
    void restoreSession(controller.signal, apply)
    const timer = setTimeout(() => void startupFallback().then(settleIfLoading), STARTUP_TIMEOUT_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [enabled, applySession, setSession, restoreRef])
}

interface VerifyDeps {
  awaiting: boolean
  epochRef: MutableRefObject<number>
  applySession: (session: Session) => Promise<void>
  setNeedsSignIn: (needed: boolean) => void
}

/** While unverified, retry `GET /auth/me`; a 401 raises the banner, never the gate (that would discard a capture). */
function useVerify({ awaiting, epochRef, applySession, setNeedsSignIn }: VerifyDeps) {
  useRetryWhileActive(awaiting, async () => {
    const epoch = epochRef.current
    const result = await verifySession()
    if (epoch !== epochRef.current) return true
    if (result === 'expired') setNeedsSignIn(true)
    else if (result) await applySession(result)
    return result !== null
  })
}

/**
 * The outbox drains only once a Google session is verified (never under
 * `none` / `unknown` or while loading; always under `dev:mocked`). Declared
 * before `useSyncOutbox`, so the gate closes before its mount-time drain.
 */
function useDrainGate(mode: AuthMode, verified: boolean) {
  useEffect(() => {
    const allowed = mode === 'mock' || (mode === 'google' && verified)
    setDrainsAllowed(allowed)
    if (allowed && mode === 'google') void drainOutbox()
  }, [mode, verified])
  useEffect(() => () => setDrainsAllowed(true), [])
}

/** With no login to do (`none` / `unknown`) the session is simply local: signed in, nothing to verify. */
function useLocalOnlySession(
  mode: AuthMode,
  setSession: (session: Session) => void,
  setNeedsSignIn: (needed: boolean) => void,
  supersede: () => void,
) {
  useEffect(() => {
    if (mode !== 'none' && mode !== 'unknown') return
    supersede()
    setSession(verifiedSession(null))
    setNeedsSignIn(false)
  }, [mode, setSession, setNeedsSignIn, supersede])
}

interface Lifecycle {
  setPending: (pending: boolean) => void
  setError: (error: string | null) => void
}

/** Runs one async account action behind the shared pending/error handling. */
async function runAction(
  { setPending, setError }: Lifecycle,
  action: () => Promise<void>,
  failureMessage: (error: unknown) => string,
): Promise<boolean> {
  setPending(true)
  setError(null)
  try {
    await action()
    return true
  } catch (err) {
    setError(failureMessage(err))
    return false
  } finally {
    setPending(false)
  }
}

interface AccountDeps extends Lifecycle {
  supersede: () => void
  session: Session
  applySession: (session: Session, wiped?: boolean) => Promise<void>
  setNeedsSignIn: (needed: boolean) => void
  setUnsyncedCount: (count: number) => void
}

function useAccountActions(deps: AccountDeps) {
  const { session, applySession, setNeedsSignIn, setUnsyncedCount, supersede, setPending, setError } = deps
  const lifecycle = useMemo(() => ({ setPending, setError }), [setPending, setError])
  const wasVerified = isVerified(session)

  const signInWithGoogle = useCallback(
    (idToken: string) =>
      runAction(
        lifecycle,
        async () => {
          supersede()
          // Never drain while a session that hasn't been matched to this
          // device's identity exists (a re-sign-in as another account).
          setDrainsAllowed(false)
          let next: Session | null = null
          try {
            next = await signInWithIdToken(idToken)
          } finally {
            setDrainsAllowed(next ? isVerified(next) : wasVerified)
          }
          await applySession(next)
          setNeedsSignIn(false)
          if (isVerified(next)) void drainOutbox()
        },
        messageForSignInError,
      ),
    [lifecycle, supersede, applySession, setNeedsSignIn, wasVerified],
  )

  const signOutAndReset = useCallback(
    async (discardUnsynced: boolean) => {
      setUnsyncedCount(0)
      await runAction(
        lifecycle,
        async () => {
          try {
            await signOut(discardUnsynced)
          } catch (err) {
            if (err instanceof UnsyncedItemsError) setUnsyncedCount(err.count)
            throw err
          }
          // Only a sign-out that went through outranks a startup check; a refused one changes nothing.
          supersede()
          await applySession(SIGNED_OUT, true)
          setNeedsSignIn(false)
        },
        (err) => (err instanceof Error && err.message ? err.message : 'Something went wrong. Try again.'),
      )
    },
    [lifecycle, supersede, applySession, setNeedsSignIn, setUnsyncedCount],
  )
  const logout = useCallback(() => signOutAndReset(false), [signOutAndReset])
  const discardUnsyncedAndLogout = useCallback(() => signOutAndReset(true), [signOutAndReset])

  return { signInWithGoogle, logout, discardUnsyncedAndLogout }
}

export function useAuth(options: UseAuthOptions = {}): UseAuthResult {
  const { mode, googleClientId } = useAuthConfig()
  const [session, setSession] = useState<Session>(() => (mode === 'mock' ? verifiedSession(null) : LOADING))
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unsyncedCount, setUnsyncedCount] = useState(0)
  const epochRef = useRef(0)
  const restoreRef = useRef<AbortController | null>(null)

  // The reset callback is a fresh function each render, so it is read through a ref.
  const resetRef = useRef(options.onLocalDataReset)
  useEffect(() => {
    resetRef.current = options.onLocalDataReset
  }, [options.onLocalDataReset])
  // A session with a notice follows a wipe: reset the in-memory list FIRST (a
  // failure is shown), so the new account never sees the old entries.
  const applySession = useCallback(async (next: Session, wiped = next.notice !== null) => {
    const epoch = epochRef.current
    if (wiped) {
      try {
        await resetRef.current?.()
      } catch {
        setError("Couldn't refresh the entries on screen. Reload the app.")
      }
    }
    if (epoch === epochRef.current) setSession(next)
  }, [])

  // A sign-in/out outranks any startup check or verification still in flight.
  const supersede = useCallback(() => {
    epochRef.current += 1
    restoreRef.current?.abort()
  }, [])

  useDrainGate(mode, isVerified(session))
  useRestoreOnMount(mode === 'google', applySession, setSession, restoreRef)
  useLocalOnlySession(mode, setSession, setNeedsSignIn, supersede)
  useVerify({
    awaiting: mode === 'google' && session.state === 'signedIn' && session.unverified,
    epochRef,
    applySession,
    setNeedsSignIn,
  })
  const { signInWithGoogle, logout, discardUnsyncedAndLogout } = useAccountActions({
    session,
    applySession,
    setNeedsSignIn,
    setUnsyncedCount,
    supersede,
    setPending,
    setError,
  })

  // Only a Google session can expire; with no login there is nothing to sign in to.
  const noteAuthRequired = useCallback(() => {
    if (mode === 'google') setNeedsSignIn(true)
  }, [mode])
  const dismissSignInPrompt = useCallback(() => setNeedsSignIn(false), [])
  const noteSynced = dismissSignInPrompt
  const dismissNotice = useCallback(() => setSession((cur) => ({ ...cur, notice: null })), [])
  const clearError = useCallback(() => setError(null), [])

  return {
    mode,
    googleClientId,
    state: session.state,
    profile: session.profile,
    unverified: session.unverified,
    needsSignIn,
    notice: session.notice,
    pending,
    error,
    unsyncedCount,
    signInWithGoogle,
    logout,
    discardUnsyncedAndLogout,
    noteSynced,
    noteAuthRequired,
    dismissSignInPrompt,
    dismissNotice,
    clearError,
  }
}

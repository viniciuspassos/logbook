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
import type { AuthMode } from '../lib/auth/authConfig.ts'
import {
  LOADING,
  SIGNED_OUT,
  STARTUP_TIMEOUT_MS,
  isVerified,
  restoreSession,
  signInWithIdToken,
  signOut,
  startupFallback,
  verifiedSession,
  verifySession,
} from '../lib/auth/sessionFlows.ts'
import { onBackOnline } from '../lib/sync/connectivity.ts'
import { SyncAuthError, SyncHttpError, SyncNetworkError } from '../lib/sync/errors.ts'
import { drainOutbox, setDrainsAllowed } from '../lib/sync/outboxRunner.ts'
import type { AuthProfile, AuthState, Session } from '../types/auth.ts'

export type { AuthState } from '../types/auth.ts'

/**
 * Owns who is signed in (Sign in with Google, #122); the decisions live in
 * `src/lib/auth/sessionFlows.ts`, this hook wires them to state. `App.tsx`
 * gates on `state`. Whether there is a login at all is the server's call
 * (`GET /auth/config`, via `useAuthConfig`): under `google` everything below
 * applies; under `none` / `unknown` the session is simply local (no gate, no
 * banner, no `GET /auth/me`, no drains); `dev:mocked` skips it all too.
 *
 * - The full-screen gate shows with no known identity, after sign-out, or on a
 *   401 from `GET /auth/me`. A background 401 only raises `needsSignIn` (a
 *   banner), so an in-progress capture draft survives.
 * - A cached identity or local entries open the app offline as `unverified`;
 *   it is verified when the app regains the network or focus.
 * - One account per device: a different user id wipes local data (`notice`).
 * - Sign-in and sign-out supersede a slow startup check, so a stale result can
 *   never overwrite them.
 * - The outbox only drains once the session is verified (`setDrainsAllowed`).
 */

export interface UseAuthOptions {
  /** This device's local data was wiped (sign-out, or a different account), so in-memory lists must reload. */
  onLocalDataReset?: () => void
}

export interface UseAuthResult {
  /** Which login the server wants: see `AuthMode`. */
  mode: AuthMode
  /** The OAuth client ID the server gave, in `google` mode. */
  googleClientId: string | null
  state: AuthState
  /** The signed-in account, when known. */
  profile: AuthProfile | null
  /** Open on a cached identity or local entries, not yet confirmed by the server. */
  unverified: boolean
  /** A background request found the session gone; show a non-blocking "sign in again". */
  needsSignIn: boolean
  /** Set when a different account signed in and this device's previous entries were removed. */
  notice: string | null
  pending: boolean
  error: string | null
  /** Exchanges a Google ID token for a session. Resolves to whether `/auth/google` accepted it; never rejects. */
  signInWithGoogle: (idToken: string) => Promise<boolean>
  /** Needs a connection: syncs first, then wipes this device. Failures land in `error`. */
  logout: () => Promise<void>
  /** Call when a background request discovers the session is gone (a 401). Ignored outside `google` mode. */
  noteAuthRequired: () => void
  /** Hides the "sign in again" prompt until the next 401. */
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
  applySession: (session: Session) => void,
  setSession: Dispatch<SetStateAction<Session>>,
  restoreRef: MutableRefObject<AbortController | null>,
) {
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    restoreRef.current = controller
    const apply = (next: Session) => {
      if (!controller.signal.aborted) applySession(next)
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
  hasProfile: boolean
  epochRef: MutableRefObject<number>
  applySession: (session: Session) => void
  setNeedsSignIn: (needed: boolean) => void
}

/**
 * While a Google session is unverified, retry `GET /auth/me` whenever the app
 * may be reachable again (online, focus, visible). Not on drain events: drains
 * are held back until this succeeds.
 */
function useVerifyOnReconnect({ awaiting, hasProfile, epochRef, applySession, setNeedsSignIn }: VerifyDeps) {
  useEffect(() => {
    if (!awaiting) return
    let verifying = false
    return onBackOnline(() => {
      if (verifying) return
      verifying = true
      const epoch = epochRef.current
      void verifySession().then((result) => {
        verifying = false
        if (epoch !== epochRef.current) return
        if (result === 'expired') {
          // A session verified before only needs a banner; one that never was has no standing.
          if (hasProfile) setNeedsSignIn(true)
          else applySession(SIGNED_OUT)
        } else if (result) applySession(result)
      })
    })
  }, [awaiting, hasProfile, epochRef, applySession, setNeedsSignIn])
}

/**
 * The outbox drains only when it is safe: with Google login, once the session
 * is verified (`/auth/me` answered and the identity check ran); never under
 * `none` / `unknown` or while the mode is still loading. `dev:mocked` always
 * drains, as it did. Declared before `useSyncOutbox` in the composition root, so
 * the gate is closed before its mount-time drain can run.
 */
function useDrainGate(mode: AuthMode, verified: boolean) {
  useEffect(() => {
    const allowed = mode === 'mock' || (mode === 'google' && verified)
    setDrainsAllowed(allowed)
    if (allowed && mode === 'google') void drainOutbox()
  }, [mode, verified])
  useEffect(() => () => setDrainsAllowed(true), [])
}

/**
 * With no login to do (`none`, or `unknown` while the server can't be asked)
 * the session is simply local: signed in, nothing to verify. This also stands
 * down a startup check or banner left over from `google`.
 */
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
  applySession: (session: Session) => void
  setNeedsSignIn: (needed: boolean) => void
  resetLocalData: () => void
}

function useAccountActions(deps: AccountDeps) {
  const { session, applySession, setNeedsSignIn, resetLocalData, supersede, setPending, setError } = deps
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
          applySession(next)
          setNeedsSignIn(false)
          if (isVerified(next)) void drainOutbox()
        },
        messageForSignInError,
      ),
    [lifecycle, supersede, applySession, setNeedsSignIn, wasVerified],
  )

  const logout = useCallback(async () => {
    await runAction(
      lifecycle,
      async () => {
        await signOut()
        // Only a sign-out that went through outranks a startup check; a refused one changes nothing.
        supersede()
        resetLocalData()
        applySession(SIGNED_OUT)
        setNeedsSignIn(false)
      },
      (err) => (err instanceof Error && err.message ? err.message : 'Something went wrong. Try again.'),
    )
  }, [lifecycle, supersede, resetLocalData, applySession, setNeedsSignIn])

  return { signInWithGoogle, logout }
}

export function useAuth(options: UseAuthOptions = {}): UseAuthResult {
  const { mode, googleClientId } = useAuthConfig()
  const [session, setSession] = useState<Session>(() => (mode === 'mock' ? verifiedSession(null) : LOADING))
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const epochRef = useRef(0)
  const restoreRef = useRef<AbortController | null>(null)

  // The reset callback is a fresh function each render, so it is read through a ref.
  const resetRef = useRef(options.onLocalDataReset)
  useEffect(() => {
    resetRef.current = options.onLocalDataReset
  }, [options.onLocalDataReset])
  const resetLocalData = useCallback(() => resetRef.current?.(), [])
  // Every session that comes with a notice has just wiped this device's data.
  const applySession = useCallback(
    (next: Session) => {
      if (next.notice) resetLocalData()
      setSession(next)
    },
    [resetLocalData],
  )

  // Any sign-in/out outranks whatever the startup check or a background
  // verification is still working on.
  const supersede = useCallback(() => {
    epochRef.current += 1
    restoreRef.current?.abort()
  }, [])

  useDrainGate(mode, isVerified(session))
  useRestoreOnMount(mode === 'google', applySession, setSession, restoreRef)
  useLocalOnlySession(mode, setSession, setNeedsSignIn, supersede)
  useVerifyOnReconnect({
    awaiting: mode === 'google' && session.state === 'signedIn' && session.unverified,
    hasProfile: session.profile !== null,
    epochRef,
    applySession,
    setNeedsSignIn,
  })
  const { signInWithGoogle, logout } = useAccountActions({
    session,
    applySession,
    setNeedsSignIn,
    resetLocalData,
    supersede,
    setPending,
    setError,
  })

  // Only a Google session can expire; with no login there is nothing to sign in to.
  const noteAuthRequired = useCallback(() => {
    if (mode === 'google') setNeedsSignIn(true)
  }, [mode])
  const dismissSignInPrompt = useCallback(() => setNeedsSignIn(false), [])
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
    signInWithGoogle,
    logout,
    noteAuthRequired,
    dismissSignInPrompt,
    dismissNotice,
    clearError,
  }
}

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
  AUTH_MODE_PAUSE,
  LOADING,
  RESTORE_TIMEOUT_MS,
  SIGNED_OUT,
  adoptAccount,
  drainReachedServer,
  resolveStuckStartup,
  restoreSession,
  signInWithIdToken,
  signOut,
  verifiedSession,
  verifySession,
} from '../lib/auth/sessionFlows.ts'
import { SyncAuthError, SyncHttpError, SyncNetworkError } from '../lib/sync/errors.ts'
import { drainOutbox, pauseDrains, resumeDrains, subscribeToDrains } from '../lib/sync/outboxRunner.ts'
import type { AuthProfile, AuthState, Session } from '../types/auth.ts'

export type { AuthState } from '../types/auth.ts'

/**
 * Owns who is signed in (Sign in with Google, #122) — a distinct concern from
 * `useSyncOutbox` (background drain scheduling) and `useEntryAttachments`
 * (one entry's gallery), so it's its own hook per CLAUDE.md's state-composition
 * rule. The decisions themselves live in `src/lib/auth/sessionFlows.ts`; this
 * hook wires them to state. `App.tsx` gates on `state`.
 *
 * The full-screen gate (`state === 'signedOut'`) shows only at startup with no
 * known identity, after an explicit sign-out, when `GET /auth/me` says 401 at
 * startup, or when a different account must confirm replacing this device's
 * data (`pendingSwitch`). It never shows because of a *background* 401 (an
 * outbox drain, a photo upload): that only raises `needsSignIn`, which the UI
 * shows as a non-blocking banner so an in-progress capture draft survives.
 *
 * It also never locks a user out offline: the cached profile, or just local
 * entries, open the app as `unverified` and a later drain that reaches the
 * server confirms it. A startup that gets stuck (e.g. IndexedDB blocked by
 * another tab) opens the same way after a short timeout instead of leaving the
 * splash up forever. Sign-in and sign-out supersede a slow startup check, so
 * a stale result can never overwrite them or re-cache a signed-out identity.
 *
 * Whether there is a gate at all is the server's call (`GET /auth/config`,
 * resolved by `useAuthConfig`): `google` runs everything above; `none` (login
 * off on the server) and `unknown` (couldn't ask, nothing cached) open the app
 * local-only, with no gate, no banner, no `GET /auth/me`, and every outbox
 * drain held back so there is no 401 churn; `unknown` asks again on reconnect
 * and switches to `google` or `none` as soon as the server answers. Under
 * `npm run dev:mocked` (sample data, no backend) the gate is skipped too.
 */

export interface UseAuthOptions {
  /** The device's local data was replaced (an account switch), so cached lists must reload. */
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
  /** Open on a cached profile or local entries, not yet confirmed by the server. */
  unverified: boolean
  /** A background request found the session gone; show a non-blocking "sign in again". */
  needsSignIn: boolean
  /** A different account signed in and must confirm removing this device's local data. */
  pendingSwitch: AuthProfile | null
  pending: boolean
  error: string | null
  /** Exchanges a Google ID token for a session. Resolves to whether `/auth/google` accepted it; never rejects. */
  signInWithGoogle: (idToken: string) => Promise<boolean>
  /** Confirms an account switch: removes the previous account's local data and opens as the new one. */
  confirmSwitch: () => Promise<void>
  /** Declines an account switch: signs the new account back out. */
  cancelSwitch: () => Promise<void>
  logout: () => Promise<void>
  /** Call when a background request elsewhere discovers the session is gone (401/403). */
  noteAuthRequired: () => void
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

interface AccountDeps {
  session: Session
  needsSignIn: boolean
  setSession: (session: Session) => void
  setNeedsSignIn: (needed: boolean) => void
  setPending: (pending: boolean) => void
  setError: (error: string | null) => void
  supersede: () => void
  onLocalDataReset?: () => void
}

/** Startup check, with a timeout so a stuck one never leaves the splash up forever. */
function useRestoreOnMount(
  enabled: boolean,
  setSession: Dispatch<SetStateAction<Session>>,
  restoreRef: MutableRefObject<AbortController | null>,
) {
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    restoreRef.current = controller
    const apply = (next: Session) => {
      if (!controller.signal.aborted) setSession(next)
    }
    // Only fills in a startup that is still waiting; never overwrites a real answer.
    const settleIfLoading = (next: Session | null) => {
      if (next && !controller.signal.aborted) setSession((cur) => (cur.state === 'loading' ? next : cur))
    }
    // If startup itself blows up there is nothing to wait for: open for an
    // existing user, otherwise show the gate.
    restoreSession(controller.signal, apply).catch(() =>
      resolveStuckStartup().then((next) => settleIfLoading(next ?? SIGNED_OUT)),
    )
    // Opening unverified is only right for someone who has local data. A
    // first-time user keeps waiting for the server (opening the app for them
    // would only gate them again mid-capture); stuck storage falls to the gate.
    const timer = setTimeout(() => void resolveStuckStartup().then(settleIfLoading), RESTORE_TIMEOUT_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [enabled, setSession, restoreRef])
}

interface VerifyDeps {
  awaiting: boolean
  hasProfile: boolean
  epochRef: MutableRefObject<number>
  setSession: (session: Session) => void
  setNeedsSignIn: (needed: boolean) => void
}

/** While unverified, confirm the session as soon as a sync attempt reaches the server again. */
function useVerifyWhenReachable({ awaiting, hasProfile, epochRef, setSession, setNeedsSignIn }: VerifyDeps) {
  useEffect(() => {
    if (!awaiting) return
    const verify = async () => {
      const epoch = epochRef.current
      const result = await verifySession()
      if (epoch !== epochRef.current) return
      if (result === 'expired') {
        // A session that was verified before only needs a banner. One that
        // never was (no cached identity) has no standing: show the gate.
        if (hasProfile) setNeedsSignIn(true)
        else setSession(SIGNED_OUT)
      } else if (result) setSession(result)
    }
    return subscribeToDrains((summary) => {
      if (drainReachedServer(summary)) void verify()
    })
  }, [awaiting, hasProfile, epochRef, setSession, setNeedsSignIn])
}

interface Lifecycle {
  supersede: () => void
  setPending: (pending: boolean) => void
  setError: (error: string | null) => void
}

/** Runs one async account action behind the shared pending/error handling. */
async function runAction(
  { supersede, setPending, setError }: Lifecycle,
  action: () => Promise<void>,
  failureMessage: (error: unknown) => string | null,
): Promise<boolean> {
  supersede()
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

function useAccountActions(deps: AccountDeps) {
  const { session, needsSignIn, setSession, setNeedsSignIn, setPending, setError, supersede, onLocalDataReset } = deps
  const { unverified, pendingSwitch } = session
  const lifecycle = useMemo(() => ({ supersede, setPending, setError }), [supersede, setPending, setError])

  const signInWithGoogle = useCallback(
    (idToken: string) =>
      runAction(
        lifecycle,
        async () => {
          const next = await signInWithIdToken(idToken)
          setSession(next)
          if (next.state !== 'signedIn') return
          setNeedsSignIn(false)
          // Anything the outbox queued while signed out can now go through.
          void drainOutbox()
        },
        messageForSignInError,
      ),
    [lifecycle, setSession, setNeedsSignIn],
  )

  const logout = useCallback(async () => {
    // Push unsynced entries to the right account while its session still works.
    const flushFirst = session.state === 'signedIn' && !unverified && !needsSignIn
    // Signing out locally never depends on the network, so a failed step has no message to show.
    await runAction(lifecycle, () => signOut(flushFirst), () => null)
    setSession(SIGNED_OUT)
    setNeedsSignIn(false)
  }, [lifecycle, session.state, unverified, needsSignIn, setSession, setNeedsSignIn])

  const confirmSwitch = useCallback(async () => {
    if (!pendingSwitch) return
    await runAction(
      lifecycle,
      async () => {
        const next = await adoptAccount(pendingSwitch)
        onLocalDataReset?.()
        setSession(next)
        setNeedsSignIn(false)
        void drainOutbox()
      },
      () => "Couldn't remove the previous account's entries from this device. Try again.",
    )
  }, [lifecycle, pendingSwitch, onLocalDataReset, setSession, setNeedsSignIn])

  return { signInWithGoogle, logout, confirmSwitch }
}

/**
 * With no login to do (`none`, or `unknown` while the server can't be asked)
 * the session is simply local: signed in, nothing to verify, nothing pending.
 * This also stands down a startup check or banner left over from `google`.
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

/**
 * Keeps the outbox quiet unless the server wants Google: until the mode is
 * known, and for `none`/`unknown`, every drain is a no-op (under its own
 * reason, so the account guard can't release it); `google` releases it and
 * drains once. `dev:mocked` is left exactly as it was.
 */
function useDrainGuard(mode: AuthMode) {
  useEffect(() => {
    if (mode === 'mock') return
    if (mode === 'google') {
      resumeDrains(AUTH_MODE_PAUSE)
      void drainOutbox()
    } else {
      void pauseDrains(AUTH_MODE_PAUSE)
    }
    return () => resumeDrains(AUTH_MODE_PAUSE)
  }, [mode])
}

export function useAuth(options: UseAuthOptions = {}): UseAuthResult {
  const { mode, googleClientId } = useAuthConfig()
  const [session, setSession] = useState<Session>(() => (mode === 'mock' ? verifiedSession(null) : LOADING))
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const epochRef = useRef(0)
  const restoreRef = useRef<AbortController | null>(null)

  // Any sign-in/out outranks whatever the startup check or a background
  // verification is still working on.
  const supersede = useCallback(() => {
    epochRef.current += 1
    restoreRef.current?.abort()
  }, [])

  useDrainGuard(mode)
  useRestoreOnMount(mode === 'google', setSession, restoreRef)
  useLocalOnlySession(mode, setSession, setNeedsSignIn, supersede)
  useVerifyWhenReachable({
    awaiting: session.state === 'signedIn' && session.unverified,
    hasProfile: session.profile !== null,
    epochRef,
    setSession,
    setNeedsSignIn,
  })
  const { signInWithGoogle, logout, confirmSwitch } = useAccountActions({
    session,
    needsSignIn,
    setSession,
    setNeedsSignIn,
    setPending,
    setError,
    supersede,
    onLocalDataReset: options.onLocalDataReset,
  })

  // Only a Google session can expire; with no login there is nothing to sign in to.
  const noteAuthRequired = useCallback(() => {
    if (mode === 'google') setNeedsSignIn(true)
  }, [mode])
  const clearError = useCallback(() => setError(null), [])

  return {
    mode,
    googleClientId,
    state: session.state,
    profile: session.profile,
    unverified: session.unverified,
    needsSignIn,
    pendingSwitch: session.pendingSwitch,
    pending,
    error,
    signInWithGoogle,
    confirmSwitch,
    cancelSwitch: logout,
    logout,
    noteAuthRequired,
    clearError,
  }
}

import { disableGoogleAutoSelect } from './googleIdentity.ts'
import {
  clearCachedIdentity,
  getCachedAuthConfig,
  getCachedIdentity,
  putCachedAuthConfig,
  putCachedIdentity,
} from '../db/identityStore.ts'
import { clearLocalData, hasLocalData } from '../db/localData.ts'
import { getAuthConfig, getMe, loginWithGoogle, logout as logoutRequest } from '../sync/authApi.ts'
import { SyncAuthError } from '../sync/errors.ts'
import { drainOutbox } from '../sync/outboxRunner.ts'
import { UNKNOWN_CONFIG, knownConfig, type AuthConfig, type ConfigState } from './authConfig.ts'
import type { AuthProfile, Session } from '../../types/auth.ts'

/**
 * The sign-in gate's decisions, as plain async functions so `useAuth` only
 * wires state. The rules (also in docs/ARCHITECTURE.md):
 *
 * - One account per device. The cached identity is what a sign-in or startup
 *   verification is compared with: a different user id wipes this device's
 *   local data (entries, outbox, sync state) and says so (`notice`).
 * - The gate shows only with no known identity, after sign-out, or when
 *   `GET /auth/me` says 401. A network failure never gates a user who has a
 *   cached identity or local entries: they get an `unverified` session that is
 *   confirmed when the app regains the network or focus.
 * - Signing out needs a connection: the outbox must be synced first and the
 *   server must confirm, so nothing queued is lost; it then wipes local data.
 */

export const ACCOUNT_CHANGED_NOTICE =
  "Signed in as a different account. This device's entries from the previous account were removed."
export const SIGN_OUT_NEEDS_CONNECTION = 'Connect to the internet and sync your entries before signing out.'
export const SIGN_OUT_NEEDS_SIGN_IN = 'Sign in again to sync your entries before signing out.'
const SIGN_OUT_WIPE_FAILED = "Couldn't remove this device's entries. Try again."

/** How long startup may wait on the network before a known device opens anyway. */
export const STARTUP_TIMEOUT_MS = 4000

export const LOADING: Session = { state: 'loading', profile: null, unverified: false, notice: null }
export const SIGNED_OUT: Session = { state: 'signedOut', profile: null, unverified: false, notice: null }

export function verifiedSession(profile: AuthProfile | null, notice: string | null = null): Session {
  return { state: 'signedIn', profile, unverified: false, notice }
}

export function unverifiedSession(profile: AuthProfile | null): Session {
  return { state: 'signedIn', profile, unverified: true, notice: null }
}

/** Whether the server confirmed who is signed in, which is what lets the outbox drain. */
export function isVerified(session: Session): boolean {
  return session.state === 'signedIn' && !session.unverified && session.profile !== null
}

/**
 * A profile the server just confirmed. If its id differs from the cached
 * identity (a different account on this device) local data is wiped first;
 * then the profile becomes the cached identity.
 */
export async function settleProfile(profile: AuthProfile, signal?: AbortSignal): Promise<Session> {
  const cached = await getCachedIdentity()
  const changed = cached !== null && String(cached.id) !== String(profile.id)
  if (changed) await clearLocalData()
  if (!signal?.aborted) await putCachedIdentity(profile)
  return verifiedSession(profile, changed ? ACCOUNT_CHANGED_NOTICE : null)
}

/**
 * The one startup fallback: a device that is already known (cached identity or
 * local entries) opens unverified; anything else returns `null`, so the caller
 * keeps waiting on the splash (or shows the gate).
 */
export async function startupFallback(): Promise<Session | null> {
  const cached = await getCachedIdentity()
  if (cached) return unverifiedSession(cached)
  return (await hasLocalData()) ? unverifiedSession(null) : null
}

/** What a failed `GET /auth/me` means: only a 401/403 revokes access. */
async function sessionAfterFailedCheck(error: unknown): Promise<Session> {
  if (error instanceof SyncAuthError) return SIGNED_OUT
  return (await startupFallback()) ?? SIGNED_OUT
}

/**
 * Works out the session on startup and reports each step through `apply`
 * (first the cached identity, then the server's verdict). `signal` aborts it
 * when a sign-in or sign-out supersedes it, after which nothing is applied
 * or cached.
 */
export async function restoreSession(signal: AbortSignal, apply: (session: Session) => void): Promise<void> {
  const cached = await getCachedIdentity()
  if (signal.aborted) return
  if (cached) apply(unverifiedSession(cached))
  try {
    const profile = await getMe(signal)
    if (signal.aborted) return
    const settled = await settleProfile(profile, signal)
    if (!signal.aborted) apply(settled)
  } catch (error) {
    if (signal.aborted) return
    const next = await sessionAfterFailedCheck(error)
    if (!signal.aborted) apply(next)
  }
}

/**
 * Re-checks an unverified session once the server is reachable again.
 * Resolves the confirmed session, `'expired'` for a 401, or `null` when it
 * still can't tell.
 */
export async function verifySession(): Promise<Session | 'expired' | null> {
  try {
    return await settleProfile(await getMe())
  } catch (error) {
    return error instanceof SyncAuthError ? 'expired' : null
  }
}

/**
 * Exchanges the Google ID token for a session. Throws only when
 * `POST /auth/google` itself fails. If the follow-up profile lookup fails the
 * session is live server-side, so the app opens unverified (and verifies when
 * it can) rather than leaving the user at the gate.
 */
export async function signInWithIdToken(idToken: string): Promise<Session> {
  await loginWithGoogle(idToken)
  try {
    return await settleProfile(await getMe())
  } catch {
    return unverifiedSession(null)
  }
}

/**
 * Signs out. It needs a connection: first the outbox is synced (anything left
 * queued, or an unreachable server, throws a message and changes nothing),
 * then the server confirms the logout (a 401 means already signed out), then
 * the cached identity and all local data are removed. Throws an `Error` whose
 * message is meant for the user.
 */
export async function signOut(): Promise<void> {
  const { stoppedReason } = await drainOutbox()
  if (stoppedReason === 'auth') throw new Error(SIGN_OUT_NEEDS_SIGN_IN)
  // 'rejected' ops are parked for good (they can never sync), so they don't block signing out.
  if (stoppedReason !== 'empty' && stoppedReason !== 'rejected' && stoppedReason !== 'unsupported') {
    throw new Error(SIGN_OUT_NEEDS_CONNECTION)
  }
  try {
    await logoutRequest()
  } catch (error) {
    if (!(error instanceof SyncAuthError && error.status === 401)) throw new Error(SIGN_OUT_NEEDS_CONNECTION, { cause: error })
  }
  await clearCachedIdentity()
  try {
    await clearLocalData()
  } catch (error) {
    throw new Error(SIGN_OUT_WIPE_FAILED, { cause: error })
  }
  disableGoogleAutoSelect()
}

/** Asks the server which login it wants and remembers a good answer; `null` when it can't say. */
export async function refreshAuthConfig(signal?: AbortSignal): Promise<AuthConfig | null> {
  const config = await getAuthConfig(signal)
  if (config) await putCachedAuthConfig(config)
  return config
}

/**
 * Works out the auth config on startup, reporting each step through `apply`:
 * the cached config first (so a start with no signal decides instantly), then
 * the server's fresh answer. With neither, it's `unknown`. Only a fresh answer
 * can change what the cache says; a failed fetch never downgrades it, and
 * nothing here touches the cached identity or any local data.
 */
export async function resolveAuthConfig(signal: AbortSignal, apply: (state: ConfigState) => void): Promise<void> {
  const cached = await getCachedAuthConfig()
  if (signal.aborted) return
  if (cached) apply(knownConfig(cached))
  const fresh = await refreshAuthConfig(signal)
  if (signal.aborted) return
  if (fresh) apply(knownConfig(fresh))
  else if (!cached) apply(UNKNOWN_CONFIG)
}

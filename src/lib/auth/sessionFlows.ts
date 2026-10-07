import { disableGoogleAutoSelect } from './googleIdentity.ts'
import {
  clearCachedIdentity,
  getCachedAuthConfig,
  getCachedIdentity,
  putCachedAuthConfig,
  putCachedIdentity,
} from '../db/identityStore.ts'
import { clearLocalData, countOutbox, hasLocalData } from '../db/localData.ts'
import { getAuthConfig, getMe, loginWithGoogle, logout as logoutRequest } from '../sync/authApi.ts'
import { SyncAuthError } from '../sync/errors.ts'
import { drainOutbox } from '../sync/outboxRunner.ts'
import { UNKNOWN_CONFIG, knownConfig, type AuthConfig, type ConfigState } from './authConfig.ts'
import type { AuthProfile, Session } from '../../types/auth.ts'

/**
 * The sign-in gate's decisions as plain async functions (rules: docs/ARCHITECTURE.md).
 * One account per device: the cached identity is what a sign-in or verification
 * is compared with; a different user id wipes local data and says so. A network
 * failure never gates a known device (it opens `unverified`). Signing out needs
 * a connection and never silently destroys unsynced work.
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
  // A check that a newer sign-in superseded must do nothing destructive.
  if (signal?.aborted) return verifiedSession(profile)
  const changed = cached !== null && String(cached.id) !== String(profile.id)
  if (changed) await clearLocalData()
  if (!signal?.aborted) await putCachedIdentity(profile)
  return verifiedSession(profile, changed ? ACCOUNT_CHANGED_NOTICE : null)
}

/** The one startup fallback: a known device (cached identity or local entries) opens unverified; else `null`. */
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

/** Works out the session on startup, reporting each step (cached identity, then the server's verdict) through `apply`. */
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

/** Re-checks an unverified session: the confirmed session, `'expired'` for a 401, or `null` when it can't tell. */
export async function verifySession(): Promise<Session | 'expired' | null> {
  try {
    return await settleProfile(await getMe())
  } catch (error) {
    return error instanceof SyncAuthError ? 'expired' : null
  }
}

/** Exchanges the ID token for a session; throws only if `POST /auth/google` fails (a failed profile lookup opens unverified). */
export async function signInWithIdToken(idToken: string): Promise<Session> {
  await loginWithGoogle(idToken)
  try {
    return await settleProfile(await getMe())
  } catch {
    return unverifiedSession(null)
  }
}

/** Sign-out refused: only operations the server rejected for good remain. */
export class UnsyncedItemsError extends Error {
  count: number

  constructor(count: number) {
    super("Some entries can't be synced and would be lost.")
    this.count = count
  }
}

/**
 * Signs out. Syncs the outbox, then reads it: anything that can still sync (or
 * an unreachable server) throws and changes nothing; only never-syncing items
 * left throws `UnsyncedItemsError` (call again with `discardUnsynced` to go
 * ahead). Then: server logout (a 401 = already out), wipe local data, and only
 * after that forget the cached identity (so a failed wipe never leaves data
 * with no known owner). Errors carry a message meant for the user.
 */
export async function signOut(discardUnsynced = false): Promise<void> {
  if (!discardUnsynced) {
    // With the drain gate closed (an unverified session) this is a no-op; the count decides.
    const { stoppedReason } = await drainOutbox()
    const { retryable, parked } = await countOutbox()
    if (retryable > 0) throw new Error(stoppedReason === 'auth' ? SIGN_OUT_NEEDS_SIGN_IN : SIGN_OUT_NEEDS_CONNECTION)
    if (parked > 0) throw new UnsyncedItemsError(parked)
  }
  try {
    await logoutRequest()
  } catch (error) {
    if (!(error instanceof SyncAuthError && error.status === 401)) throw new Error(SIGN_OUT_NEEDS_CONNECTION, { cause: error })
  }
  try {
    await clearLocalData()
  } catch (error) {
    throw new Error(SIGN_OUT_WIPE_FAILED, { cause: error })
  }
  await clearCachedIdentity()
  disableGoogleAutoSelect()
}

/** Asks the server which login it wants and remembers a good answer; `null` when it can't say. */
export async function refreshAuthConfig(signal?: AbortSignal): Promise<AuthConfig | null> {
  const config = await getAuthConfig(signal)
  if (config) await putCachedAuthConfig(config)
  return config
}

/** Resolves the auth config on startup: cached first (decides offline), then fresh; neither means `unknown`. */
export async function resolveAuthConfig(signal: AbortSignal, apply: (state: ConfigState) => void): Promise<void> {
  const cached = await getCachedAuthConfig()
  if (signal.aborted) return
  if (cached) apply(knownConfig(cached))
  const fresh = await refreshAuthConfig(signal)
  if (signal.aborted) return
  if (fresh) apply(knownConfig(fresh))
  else if (!cached) apply(UNKNOWN_CONFIG)
}

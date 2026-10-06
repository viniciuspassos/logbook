import { disableGoogleAutoSelect } from './googleIdentity.ts'
import {
  clearCachedIdentity,
  clearPendingLogout,
  getCachedAuthConfig,
  getCachedIdentity,
  hasPendingLogout,
  putCachedAuthConfig,
  putCachedIdentity,
  setPendingLogout,
} from '../db/identityStore.ts'
import { checkLocalOwner, claimLocalData, hasLocalData } from '../db/localOwner.ts'
import { getAuthConfig, getMe, loginWithGoogle, logout as logoutRequest } from '../sync/authApi.ts'
import { SyncAuthError } from '../sync/errors.ts'
import { drainOutbox, pauseDrains, resumeDrains, type DrainSummary } from '../sync/outboxRunner.ts'
import { UNKNOWN_CONFIG, knownConfig, type AuthConfig, type ConfigState } from './authConfig.ts'
import type { AuthProfile, Session } from '../../types/auth.ts'

/**
 * The sign-in gate's decisions, as plain async functions so `useAuth` only
 * wires state. The rules they implement (also in docs/ARCHITECTURE.md):
 *
 * - The gate shows only with no known identity, after sign-out, or when
 *   `GET /auth/me` says 401 at startup. A network failure never gates a user
 *   who has a cached profile or local entries: they get an `unverified`
 *   session that is confirmed later.
 * - Signing out is durable: a marker survives until the server confirms the
 *   logout, and startup honours it, so `GET /auth/me` can't resurrect a user
 *   who signed out offline.
 * - Local data belongs to one account. A different account must confirm
 *   before the old data is removed (`settleProfile` -> `pendingSwitch`).
 */

/** Why drains are held back, so the two guards can't release each other (see outboxRunner.ts). */
export const ACCOUNT_PAUSE = 'account'
export const AUTH_MODE_PAUSE = 'auth-mode'

export const LOADING: Session = { state: 'loading', profile: null, unverified: false, pendingSwitch: null }
export const SIGNED_OUT: Session = { state: 'signedOut', profile: null, unverified: false, pendingSwitch: null }

export function verifiedSession(profile: AuthProfile | null): Session {
  return { state: 'signedIn', profile, unverified: false, pendingSwitch: null }
}

export function unverifiedSession(profile: AuthProfile | null): Session {
  return { state: 'signedIn', profile, unverified: true, pendingSwitch: null }
}

/** A drain that got an answer from the server (even a 401), as opposed to one that never left the device. */
export function drainReachedServer(summary: DrainSummary): boolean {
  return !['unreachable', 'unsupported', 'aborted'].includes(summary.stoppedReason)
}

/**
 * A profile the server just confirmed: check it owns this device's data, and
 * only then cache it. A different owner returns a gate session carrying the
 * profile as `pendingSwitch` and caches nothing.
 */
export async function settleProfile(profile: AuthProfile, signal?: AbortSignal): Promise<Session> {
  if ((await checkLocalOwner(profile.id)) === 'mismatch') {
    // The new account's session may already be live while the previous
    // account's queue is still here: block every drain until this is resolved.
    await pauseDrains(ACCOUNT_PAUSE)
    return { ...SIGNED_OUT, pendingSwitch: profile }
  }
  if (!signal?.aborted) await putCachedIdentity(profile)
  return verifiedSession(profile)
}

async function retryServerLogout(): Promise<void> {
  try {
    await logoutRequest()
    await clearPendingLogout()
  } catch {
    // Still offline: the marker stays and the next startup tries again.
  }
}

/** What a failed `GET /auth/me` means: only a 401/403 revokes access. */
async function sessionAfterFailedCheck(error: unknown, cached: AuthProfile | null): Promise<Session> {
  if (error instanceof SyncAuthError) return SIGNED_OUT
  if (cached) return unverifiedSession(cached)
  return (await hasLocalData()) ? unverifiedSession(null) : SIGNED_OUT
}

/**
 * Works out the session on startup and reports each step through `apply`
 * (first the cached profile, then the server's verdict). `signal` aborts it
 * when a sign-in or sign-out supersedes it, after which nothing is applied
 * or cached.
 */
export async function restoreSession(signal: AbortSignal, apply: (session: Session) => void): Promise<void> {
  if (await hasPendingLogout()) {
    await retryServerLogout()
    if (!signal.aborted) apply(SIGNED_OUT)
    return
  }
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
    const next = await sessionAfterFailedCheck(error, cached)
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

async function fetchProfileWithRetry(): Promise<AuthProfile | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await getMe()
    } catch {
      // Retry once, then fall back to an unverified session.
    }
  }
  return null
}

/**
 * Exchanges the Google ID token for a session. Throws only when
 * `POST /auth/google` itself fails. If the follow-up profile lookup fails the
 * session is live server-side, so the user opens unverified rather than being
 * stuck at the gate; the profile is filled in later by `verifySession`.
 *
 * Drains are paused *before* the new session exists and stay paused if the
 * account turns out to be a different one (`pendingSwitch`), so the previous
 * account's queue can't be uploaded under it, not even in the gap before the
 * ownership check.
 */
export async function signInWithIdToken(idToken: string): Promise<Session> {
  await pauseDrains(ACCOUNT_PAUSE)
  let session: Session
  try {
    await loginWithGoogle(idToken)
    await clearPendingLogout()
    const profile = await fetchProfileWithRetry()
    session = profile ? await settleProfile(profile) : unverifiedSession(null)
  } catch (error) {
    resumeDrains(ACCOUNT_PAUSE)
    throw error
  }
  if (session.pendingSwitch === null) resumeDrains(ACCOUNT_PAUSE)
  return session
}

/** The user confirmed a switch: remove the previous account's local data and open as the new one. */
export async function adoptAccount(profile: AuthProfile): Promise<Session> {
  await claimLocalData(profile.id)
  await putCachedIdentity(profile)
  await clearPendingLogout()
  resumeDrains(ACCOUNT_PAUSE)
  return verifiedSession(profile)
}

/** How long sign-out waits for the final flush before signing out regardless. */
export const SIGN_OUT_FLUSH_TIMEOUT_MS = 5000

async function drainBeforeSignOut(): Promise<void> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const bound = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve()
    }, SIGN_OUT_FLUSH_TIMEOUT_MS)
  })
  try {
    // Best-effort and bounded: a hung drain must never keep the user signed in.
    await Promise.race([drainOutbox(controller.signal).then(() => undefined, () => undefined), bound])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Signs out durably. With `flushFirst` it tries to push the queue while the
 * session is still valid (so unsynced entries reach the right account).
 * The marker is written before anything else can fail, and removed only once
 * the server confirms the logout.
 */
export async function signOut(flushFirst: boolean): Promise<void> {
  if (flushFirst) await drainBeforeSignOut()
  await setPendingLogout()
  await clearCachedIdentity()
  await retryServerLogout()
  disableGoogleAutoSelect()
}

/** How long a startup with no cached identity may wait before checking what is on this device. */
export const RESTORE_TIMEOUT_MS = 4000
/** How long that check itself may take before IndexedDB is considered stuck. */
export const LOCAL_PROBE_TIMEOUT_MS = 1000

/**
 * What this device holds, without letting a stuck IndexedDB hang the caller:
 * `'data'` (local entries), `'none'` (a fresh device), or `'stuck'` (storage
 * didn't answer within LOCAL_PROBE_TIMEOUT_MS).
 */
export async function probeLocalData(): Promise<'data' | 'none' | 'stuck'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const stuck = new Promise<'stuck'>((resolve) => {
    timer = setTimeout(() => resolve('stuck'), LOCAL_PROBE_TIMEOUT_MS)
  })
  try {
    const hasData = await Promise.race([hasLocalData(), stuck])
    if (hasData === 'stuck') return 'stuck'
    return hasData ? 'data' : 'none'
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Decides what a startup that is still waiting should do. An existing user
 * (local entries) opens unverified; a first-time user (nothing local) returns
 * `null` and keeps waiting on the splash for the server's answer, since opening
 * the app for them would only gate them again mid-capture. If IndexedDB is the
 * thing that's stuck, there is nothing to open: show the gate.
 */
export async function resolveStuckStartup(): Promise<Session | null> {
  const found = await probeLocalData()
  if (found === 'stuck') return SIGNED_OUT
  return found === 'data' ? unverifiedSession(null) : null
}

/**
 * The same rule for the wait on `GET /auth/config`: an existing user, or stuck
 * storage, opens as `unknown` (local-only; asking again when back online), and
 * a first-time user with nothing local keeps waiting on the splash. Nobody is
 * gated here, because without a config there is no login to gate on.
 */
export async function resolveStuckConfig(): Promise<ConfigState | null> {
  return (await probeLocalData()) === 'none' ? null : UNKNOWN_CONFIG
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

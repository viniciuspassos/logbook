import { disableGoogleAutoSelect } from './googleIdentity.ts'
import {
  clearCachedIdentity,
  clearPendingLogout,
  getCachedIdentity,
  hasPendingLogout,
  putCachedIdentity,
  setPendingLogout,
} from '../db/identityStore.ts'
import { checkLocalOwner, claimLocalData, hasLocalData } from '../db/localOwner.ts'
import { getMe, loginWithGoogle, logout as logoutRequest } from '../sync/authApi.ts'
import { SyncAuthError } from '../sync/errors.ts'
import { drainOutbox, type DrainSummary } from '../sync/outboxRunner.ts'
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
  if ((await checkLocalOwner(profile.id)) === 'mismatch') return { ...SIGNED_OUT, pendingSwitch: profile }
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
 */
export async function signInWithIdToken(idToken: string): Promise<Session> {
  await loginWithGoogle(idToken)
  await clearPendingLogout()
  const profile = await fetchProfileWithRetry()
  return profile ? settleProfile(profile) : unverifiedSession(null)
}

/** The user confirmed a switch: remove the previous account's local data and open as the new one. */
export async function adoptAccount(profile: AuthProfile): Promise<Session> {
  await claimLocalData(profile.id)
  await putCachedIdentity(profile)
  await clearPendingLogout()
  return verifiedSession(profile)
}

async function drainBeforeSignOut(): Promise<void> {
  try {
    await drainOutbox()
  } catch {
    // Best-effort: whatever can't be sent stays queued for the same account.
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

import { IDENTITY_STORE as STORE, openLogbookDb } from './database.ts'
import type { AuthProfile } from '../../types/auth.ts'

/**
 * Thin wrapper over IndexedDB for the last signed-in profile. It is what lets
 * the login gate stay open offline: after one successful Google sign-in the
 * profile is cached here, so reopening the app with no signal (or an
 * unreachable backend) still counts as "a known identity" and never locks the
 * user out of their own local logbook. It is cleared only on an explicit
 * sign-out; a server-side 401 leaves it alone (see `useAuth`).
 *
 * This is a convenience cache, not a security boundary — the backend session
 * cookie is what authorises sync. Every function therefore degrades quietly
 * (null / no-op) when IndexedDB is unavailable or fails, rather than letting a
 * storage error block the app from opening.
 */

const KEY = 'current'

interface IdentityRecord {
  key: typeof KEY
  profile: AuthProfile
}

function isProfile(value: unknown): value is AuthProfile {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as { email?: unknown }).email === 'string'
}

async function withStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openLogbookDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = work(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(request.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/** The cached profile, or `null` if nobody has signed in here (or storage is unavailable). */
export async function getCachedIdentity(): Promise<AuthProfile | null> {
  try {
    const record = await withStore<IdentityRecord | undefined>('readonly', (store) => store.get(KEY))
    return isProfile(record?.profile) ? record.profile : null
  } catch {
    return null
  }
}

/** Remembers the signed-in profile (replacing any previous one). */
export async function putCachedIdentity(profile: AuthProfile): Promise<void> {
  try {
    const record: IdentityRecord = { key: KEY, profile }
    await withStore('readwrite', (store) => store.put(record))
  } catch {
    // A cache write that fails just means the next offline open shows the gate.
  }
}

/** Forgets the cached profile (explicit sign-out). */
export async function clearCachedIdentity(): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(KEY))
  } catch {
    // Nothing useful to do; the in-memory state has already moved on.
  }
}

import { IDENTITY_STORE as STORE, openLogbookDb } from './database.ts'
import type { AuthProfile } from '../../types/auth.ts'

/**
 * Thin wrapper over IndexedDB for who this device belongs to. Three small
 * records share the `identity` store:
 *
 * - `current`: the last signed-in profile. It lets the login gate stay open
 *   offline: after one successful Google sign-in, reopening the app with no
 *   signal still counts as "a known identity" and never locks the user out of
 *   their own local logbook. Cleared by an explicit sign-out.
 * - `pendingLogout`: a durable "the user signed out" marker. Signing out while
 *   offline can't clear the server cookie, so the marker makes the next
 *   startup retry the server logout instead of letting `GET /auth/me`
 *   silently sign the user back in.
 * - `owner`: the id of the account that owns this device's local entries,
 *   outbox and sync state (see localOwner.ts). It survives sign-out on
 *   purpose: signing back in as the same account keeps everything, signing in
 *   as a different one is caught.
 *
 * None of this is a security boundary (the backend session cookie is what
 * authorises sync), so every function degrades quietly (null / no-op) when
 * IndexedDB is unavailable or fails, rather than blocking the app from opening.
 */

type RecordKey = 'current' | 'pendingLogout' | 'owner'

interface IdentityRecord {
  key: RecordKey
  profile?: AuthProfile
  ownerId?: string
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

async function readRecord(key: RecordKey): Promise<IdentityRecord | undefined> {
  try {
    return await withStore<IdentityRecord | undefined>('readonly', (store) => store.get(key))
  } catch {
    return undefined
  }
}

async function writeRecord(record: IdentityRecord): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.put(record))
  } catch {
    // A write that fails just means the next offline open degrades gracefully.
  }
}

async function deleteRecord(key: RecordKey): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(key))
  } catch {
    // Nothing useful to do; the in-memory state has already moved on.
  }
}

/** The cached profile, or `null` if nobody has signed in here (or storage is unavailable). */
export async function getCachedIdentity(): Promise<AuthProfile | null> {
  const record = await readRecord('current')
  return isProfile(record?.profile) ? record.profile : null
}

/** Remembers the signed-in profile (replacing any previous one). */
export function putCachedIdentity(profile: AuthProfile): Promise<void> {
  return writeRecord({ key: 'current', profile })
}

/** Forgets the cached profile (explicit sign-out). */
export function clearCachedIdentity(): Promise<void> {
  return deleteRecord('current')
}

/** Whether the user signed out and the server-side logout hasn't been confirmed yet. */
export async function hasPendingLogout(): Promise<boolean> {
  return (await readRecord('pendingLogout')) !== undefined
}

/** Records that the user signed out, until the server confirms it. */
export function setPendingLogout(): Promise<void> {
  return writeRecord({ key: 'pendingLogout' })
}

/** The server-side logout went through (or a new sign-in superseded it). */
export function clearPendingLogout(): Promise<void> {
  return deleteRecord('pendingLogout')
}

/** The account id that owns this device's local data, or `null` if none is recorded yet. */
export async function getLocalOwnerId(): Promise<string | null> {
  const record = await readRecord('owner')
  return typeof record?.ownerId === 'string' ? record.ownerId : null
}

/** Records which account owns this device's local data. */
export function putLocalOwnerId(ownerId: string): Promise<void> {
  return writeRecord({ key: 'owner', ownerId })
}

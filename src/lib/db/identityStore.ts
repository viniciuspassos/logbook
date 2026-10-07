import { IDENTITY_STORE as STORE, openLogbookDb } from './database.ts'
import { parseAuthConfig, type AuthConfig } from '../auth/authConfig.ts'
import type { AuthProfile } from '../../types/auth.ts'

/**
 * IndexedDB wrapper for who this device belongs to (one account per device):
 * `current` is the last signed-in profile (it keeps the gate open offline and is
 * what a later sign-in is compared with); `authConfig` is the last good
 * `GET /auth/config`. Not a security boundary, so every function degrades
 * quietly (null / no-op) when IndexedDB fails.
 */

type RecordKey = 'current' | 'authConfig'

interface IdentityRecord {
  key: RecordKey
  profile?: AuthProfile
  authConfig?: unknown
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

/** The last good auth config the server gave, or `null` if it has never answered (or storage fails). */
export async function getCachedAuthConfig(): Promise<AuthConfig | null> {
  return parseAuthConfig((await readRecord('authConfig'))?.authConfig)
}

/** Remembers the server's auth config so a later offline start can still decide. */
export function putCachedAuthConfig(config: AuthConfig): Promise<void> {
  return writeRecord({ key: 'authConfig', authConfig: config })
}

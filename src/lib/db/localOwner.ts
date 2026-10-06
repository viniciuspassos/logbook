import { ENTRIES_STORE, IDENTITY_STORE, OUTBOX_STORE, SYNC_STATE_STORE, isPersistenceSupported, openLogbookDb } from './database.ts'
import { getAllEntries } from './entriesStore.ts'
import { getLocalOwnerId, ownerRecord, putLocalOwnerId } from './identityStore.ts'

/**
 * Keeps one account's local data from leaking into another's. Entries, the
 * outbox and the sync-state map all live in this browser's IndexedDB and are
 * not per-user, so without this a different Google account signing in on the
 * same device would see the previous account's entries and, worse, the outbox
 * would upload them under the new account.
 *
 * The device records the owning account id (identityStore's `owner` record).
 * Data that predates sign-in has no owner and belongs to the first account to
 * sign in, which matches the backend's first-user claim. Signing back in as
 * the same account keeps everything; a different account is a `'mismatch'`
 * that the UI must confirm before `claimLocalData` removes the old data.
 */

export type OwnerCheck = 'ok' | 'mismatch'

/** Compares the signed-in account to the device's owner, adopting it if there is none yet. */
export async function checkLocalOwner(accountId: string | number): Promise<OwnerCheck> {
  const id = String(accountId)
  const owner = await getLocalOwnerId()
  if (owner === null) {
    await putLocalOwnerId(id)
    return 'ok'
  }
  return owner === id ? 'ok' : 'mismatch'
}

function wipeAndRecordOwner(db: IDBDatabase, ownerId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const wiped = [ENTRIES_STORE, OUTBOX_STORE, SYNC_STATE_STORE]
    const tx = db.transaction([...wiped, IDENTITY_STORE], 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
    try {
      for (const name of wiped) tx.objectStore(name).clear()
      tx.objectStore(IDENTITY_STORE).put(ownerRecord(ownerId))
    } catch (error) {
      // Roll back whatever was already queued, so a failure never leaves the
      // device wiped but still owned by the previous account.
      tx.abort()
      reject(error)
    }
  })
}

/**
 * Removes the previous account's entries, outbox and sync state and records
 * `accountId` as the owner, all in ONE transaction: it either fully happens
 * or the device is left exactly as it was, and the returned promise rejects so
 * the caller never opens the app on a half-switched device.
 */
export async function claimLocalData(accountId: string | number): Promise<void> {
  const db = await openLogbookDb()
  try {
    await wipeAndRecordOwner(db, String(accountId))
  } finally {
    db.close()
  }
}

/**
 * Whether this device already holds a logbook. Answers `true` when it can't
 * tell (IndexedDB unavailable or unreadable): not knowing must never lock
 * someone out of an app that might hold their entries.
 */
export async function hasLocalData(): Promise<boolean> {
  if (!isPersistenceSupported()) return true
  try {
    return (await getAllEntries()).length > 0
  } catch {
    return true
  }
}

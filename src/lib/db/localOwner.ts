import { ENTRIES_STORE, OUTBOX_STORE, SYNC_STATE_STORE, isPersistenceSupported, openLogbookDb } from './database.ts'
import { getAllEntries } from './entriesStore.ts'
import { getLocalOwnerId, putLocalOwnerId } from './identityStore.ts'

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

function clearStores(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const names = [ENTRIES_STORE, OUTBOX_STORE, SYNC_STATE_STORE]
    const tx = db.transaction(names, 'readwrite')
    for (const name of names) tx.objectStore(name).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/**
 * Removes the previous account's entries, outbox and sync state in one
 * transaction, then records `accountId` as the owner. Rejects (leaving the
 * owner untouched) if the data can't be cleared, so the caller never opens the
 * app on a half-wiped device.
 */
export async function claimLocalData(accountId: string | number): Promise<void> {
  const db = await openLogbookDb()
  try {
    await clearStores(db)
  } finally {
    db.close()
  }
  await putLocalOwnerId(String(accountId))
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

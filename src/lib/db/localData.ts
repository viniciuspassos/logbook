import { ENTRIES_STORE, OUTBOX_STORE, SYNC_STATE_STORE, isPersistenceSupported, openLogbookDb } from './database.ts'
import { getAllEntries } from './entriesStore.ts'
import { getAllRecords } from './outboxStore.ts'

/**
 * What this device holds locally: entries, the outbox and the sync-state map
 * (the identity store is separate). One account per device, so signing out, or
 * signing in as someone else, wipes all three together.
 */

/**
 * Wipes entries, outbox and sync state in ONE transaction: all or nothing, and
 * it rejects on failure so the caller never carries on with a half-wiped
 * device. With no IndexedDB there is nothing to wipe.
 */
export async function clearLocalData(): Promise<void> {
  if (!isPersistenceSupported()) return
  const db = await openLogbookDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const names = [ENTRIES_STORE, OUTBOX_STORE, SYNC_STATE_STORE]
      const tx = db.transaction(names, 'readwrite')
      for (const name of names) tx.objectStore(name).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
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

/**
 * What is still waiting in the outbox: `retryable` operations that can still
 * sync, and `parked` ones the server rejected for good (they never will).
 * Sign-out decides from this, not from how the last drain happened to end.
 */
export async function countOutbox(): Promise<{ retryable: number; parked: number }> {
  if (!isPersistenceSupported()) return { retryable: 0, parked: 0 }
  const records = await getAllRecords()
  const parked = records.filter((record) => record.rejected).length
  return { retryable: records.length - parked, parked }
}

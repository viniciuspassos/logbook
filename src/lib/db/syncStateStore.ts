import { SYNC_STATE_STORE as STORE, openLogbookDb } from './database.ts'
import type { EntrySyncState } from '../../types/outbox.ts'

/**
 * Thin wrapper over the raw IndexedDB API for #26's local-id -> server-id
 * reconciliation map (see types/outbox.ts's EntrySyncState docstring).
 * `src/lib/sync/outboxQueue.ts` and `outboxRunner.ts` are the only callers.
 */

function runWrite(
  db: IDBDatabase,
  work: (store: IDBObjectStore) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    work(tx.objectStore(STORE))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/** The sync state for a local entry, or `undefined` if it has never synced. */
export async function getSyncState(localEntryId: number): Promise<EntrySyncState | undefined> {
  const db = await openLogbookDb()
  try {
    return await new Promise<EntrySyncState | undefined>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(localEntryId)
      request.onsuccess = () => resolve(request.result as EntrySyncState | undefined)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

/** Insert or overwrite the sync state for a local entry (keyed by localEntryId). */
export async function putSyncState(state: EntrySyncState): Promise<void> {
  const db = await openLogbookDb()
  try {
    await runWrite(db, (store) => store.put(state))
  } finally {
    db.close()
  }
}

/** Removes the mapping for a local entry (no-op if there isn't one). */
export async function deleteSyncState(localEntryId: number): Promise<void> {
  const db = await openLogbookDb()
  try {
    await runWrite(db, (store) => store.delete(localEntryId))
  } finally {
    db.close()
  }
}

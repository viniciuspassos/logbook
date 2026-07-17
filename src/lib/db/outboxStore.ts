import { OUTBOX_STORE as STORE, openLogbookDb } from './database.ts'
import type { NewOutboxRecord, OutboxRecord } from '../../types/outbox.ts'

/**
 * Thin wrapper over the raw IndexedDB API for #26's offline write queue.
 * Mirrors entriesStore.ts's shape (open -> single transaction -> close) so
 * the two stay easy to read side by side. `src/lib/sync/outboxQueue.ts` is
 * the only caller — screens/hooks never import this module directly, same
 * layering as entriesStore.ts behind useEntries.
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

/** Appends a new operation to the end of the queue, assigning it a queueId. */
export async function enqueueOperation(operation: NewOutboxRecord['operation']): Promise<OutboxRecord> {
  const db = await openLogbookDb()
  try {
    const record: Omit<OutboxRecord, 'queueId'> = {
      createdAt: new Date().toISOString(),
      attempts: 0,
      operation,
    }
    const queueId = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const request = tx.objectStore(STORE).add(record)
      request.onsuccess = () => resolve(request.result as number)
      request.onerror = () => reject(request.error)
    })
    return { ...record, queueId }
  } finally {
    db.close()
  }
}

/** All queued operations, oldest-first (ascending queueId) — the order the
 *  runner must process them in to preserve create-before-dependents. */
export async function getAllRecords(): Promise<OutboxRecord[]> {
  const db = await openLogbookDb()
  try {
    const records = await new Promise<OutboxRecord[]>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      request.onsuccess = () => resolve(request.result as OutboxRecord[])
      request.onerror = () => reject(request.error)
    })
    return records.sort((a, b) => a.queueId - b.queueId)
  } finally {
    db.close()
  }
}

/** Removes a queued operation once it has drained successfully (or is
 *  determined to be a no-op) — a no-op itself if the id is already gone. */
export async function removeRecord(queueId: number): Promise<void> {
  const db = await openLogbookDb()
  try {
    await runWrite(db, (store) => store.delete(queueId))
  } finally {
    db.close()
  }
}

/** Bumps `attempts` and stores `message` as `lastError` after a failed drain
 *  attempt. A no-op if the record was concurrently removed. */
export async function recordAttemptFailure(queueId: number, message: string): Promise<void> {
  const db = await openLogbookDb()
  try {
    const existing = await new Promise<OutboxRecord | undefined>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(queueId)
      request.onsuccess = () => resolve(request.result as OutboxRecord | undefined)
      request.onerror = () => reject(request.error)
    })
    if (!existing) return
    const updated: OutboxRecord = { ...existing, attempts: existing.attempts + 1, lastError: message }
    await runWrite(db, (store) => store.put(updated))
  } finally {
    db.close()
  }
}

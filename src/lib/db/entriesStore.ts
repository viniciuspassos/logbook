import type { Entry } from '../../types/entry.ts'

/**
 * Thin wrapper over the raw IndexedDB API for persisting logbook entries. Kept
 * dependency-free (the API surface is small) and behind async functions so the
 * consuming hook never touches request/transaction plumbing directly.
 *
 * Entries are keyed by their numeric `id` and read back newest-first (highest
 * id), so a freshly saved entry — which always takes the next-highest id —
 * stays at the top of the timeline across reloads.
 */

const DB_NAME = 'logbook'
const DB_VERSION = 1
const STORE = 'entries'

/** Whether this environment can persist at all (false in SSR/jsdom). */
export function isPersistenceSupported(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Resolve/reject a write transaction as a whole so callers can await it. */
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

/** All persisted entries, newest-first (descending id). */
export async function getAllEntries(): Promise<Entry[]> {
  const db = await openDb()
  try {
    const entries = await new Promise<Entry[]>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      request.onsuccess = () => resolve(request.result as Entry[])
      request.onerror = () => reject(request.error)
    })
    return entries.sort((a, b) => b.id - a.id)
  } finally {
    db.close()
  }
}

/** Insert or update a single entry (keyed by `id`). */
export async function putEntry(entry: Entry): Promise<Entry> {
  const db = await openDb()
  try {
    await runWrite(db, (store) => store.put(entry))
    return entry
  } finally {
    db.close()
  }
}

/** Insert or update many entries in one transaction (used to seed the store). */
export async function putEntries(entries: Entry[]): Promise<void> {
  if (entries.length === 0) return
  const db = await openDb()
  try {
    await runWrite(db, (store) => {
      for (const entry of entries) store.put(entry)
    })
  } finally {
    db.close()
  }
}

/**
 * Replace the entire store with `entries`, in a single transaction — used when
 * restoring a backup. Atomic by design: a failure part-way through aborts the
 * transaction and leaves the existing entries intact rather than half-wiped.
 */
export async function replaceAllEntries(entries: Entry[]): Promise<void> {
  const db = await openDb()
  try {
    await runWrite(db, (store) => {
      store.clear()
      for (const entry of entries) store.put(entry)
    })
  } finally {
    db.close()
  }
}

/** Remove an entry by id (no-op if it doesn't exist). */
export async function deleteEntry(id: number): Promise<void> {
  const db = await openDb()
  try {
    await runWrite(db, (store) => store.delete(id))
  } finally {
    db.close()
  }
}

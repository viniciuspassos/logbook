import { shouldUseMockData } from '../config/mockData.ts'

/**
 * Shared IndexedDB opener for every store under `src/lib/db`. All stores
 * (entries, outbox, entrySyncState) live in a single database so they get
 * created together in one `onupgradeneeded` transaction — IndexedDB only
 * allows creating object stores during a version-change transaction, so a
 * per-file opener (as entriesStore.ts had pre-#26) can't add a sibling store
 * without every other opener racing it on the same version bump. Centralising
 * the open call here means adding a store is a one-place change.
 *
 * `entriesStore.ts` pre-dates #26 at version 1 with only the entries store;
 * bumping to version 2 here upgrades an existing user's database in place
 * (see database.test.ts's upgrade test) without touching their data.
 */

/**
 * `npm run dev:mocked` opens its own database, distinct from the one
 * `npm run dev`/production use. Both run against the same origin
 * (localhost:5173), so without this split, a single `dev:mocked` run seeds
 * the shared database and its sample entries keep showing up in every plain
 * `npm run dev` afterwards too — the seeding check in `useEntries`/this
 * module only guards against seeding a store that already has *any* entries,
 * it can't tell a previously-seeded sample apart from a real one once it's
 * been written.
 */
export function getDbName(): string {
  return shouldUseMockData() ? 'logbook-mocked' : 'logbook'
}

export const DB_VERSION = 2

export const ENTRIES_STORE = 'entries'
/** #26: durable write queue for entry/attachment mutations made while
 *  offline or when a write to the backend fails. */
export const OUTBOX_STORE = 'outbox'
/** #26: local entry id -> server entry id (+ last known server version)
 *  mapping. The server mints its own id on POST /entries; this store is the
 *  single source of truth for "has this local entry synced, and what's its
 *  server id" — see outboxRunner.ts. */
export const SYNC_STATE_STORE = 'entrySyncState'

/** Whether this environment can persist at all (false in SSR/jsdom). */
export function isPersistenceSupported(): boolean {
  return typeof indexedDB !== 'undefined'
}

export function openLogbookDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment.'))
      return
    }
    const request = indexedDB.open(getDbName(), DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(ENTRIES_STORE)) {
        db.createObjectStore(ENTRIES_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: 'queueId', autoIncrement: true })
      }
      if (!db.objectStoreNames.contains(SYNC_STATE_STORE)) {
        db.createObjectStore(SYNC_STATE_STORE, { keyPath: 'localEntryId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

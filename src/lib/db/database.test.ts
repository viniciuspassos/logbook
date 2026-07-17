// A real IndexedDB is required to exercise this module. jsdom has none, so
// this suite installs the `fake-indexeddb` polyfill for its own module scope
// only — see entriesStore.test.ts for the same pattern and why the JSON
// structuredClone shim is needed alongside it.
function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = jsonClone
}
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import {
  DB_NAME,
  DB_VERSION,
  ENTRIES_STORE,
  OUTBOX_STORE,
  SYNC_STATE_STORE,
  isPersistenceSupported,
  openLogbookDb,
} from './database.ts'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

describe('isPersistenceSupported', () => {
  it('reports true when indexedDB exists', () => {
    expect(isPersistenceSupported()).toBe(true)
  })

  it('reports false when indexedDB is absent', () => {
    // @ts-expect-error deliberately simulating an environment without IndexedDB
    delete globalThis.indexedDB
    expect(isPersistenceSupported()).toBe(false)
  })
})

describe('openLogbookDb', () => {
  it('creates all three object stores on a fresh database', async () => {
    const db = await openLogbookDb()
    try {
      expect(Array.from(db.objectStoreNames).sort()).toEqual(
        [ENTRIES_STORE, OUTBOX_STORE, SYNC_STATE_STORE].sort(),
      )
    } finally {
      db.close()
    }
  })

  it('upgrades an existing v1 database (entries store only) without losing data', async () => {
    // Simulate a real user's pre-#26 database: version 1, only the entries store.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore(ENTRIES_STORE, { keyPath: 'id' })
      }
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(ENTRIES_STORE, 'readwrite')
        tx.objectStore(ENTRIES_STORE).put({ id: 1, title: 'Pre-existing entry' })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      request.onerror = () => reject(request.error)
    })

    const db = await openLogbookDb()
    try {
      expect(db.version).toBe(DB_VERSION)
      expect(Array.from(db.objectStoreNames).sort()).toEqual(
        [ENTRIES_STORE, OUTBOX_STORE, SYNC_STATE_STORE].sort(),
      )
      const entry = await new Promise((resolve, reject) => {
        const request = db.transaction(ENTRIES_STORE, 'readonly').objectStore(ENTRIES_STORE).get(1)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      expect(entry).toEqual({ id: 1, title: 'Pre-existing entry' })
    } finally {
      db.close()
    }
  })

  it('rejects when indexedDB is unavailable', async () => {
    // @ts-expect-error deliberately simulating an environment without IndexedDB
    delete globalThis.indexedDB
    await expect(openLogbookDb()).rejects.toBeDefined()
  })
})

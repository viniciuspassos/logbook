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
  DB_VERSION,
  ENTRIES_STORE,
  OUTBOX_STORE,
  SYNC_STATE_STORE,
  getDbName,
  isPersistenceSupported,
  openLogbookDb,
} from './database.ts'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  delete (globalThis as { __LOGBOOK_MOCKED__?: boolean }).__LOGBOOK_MOCKED__
})

describe('getDbName', () => {
  it('defaults to the real database name when the mocked flag is unset', () => {
    expect(getDbName()).toBe('logbook')
  })

  it('resolves to a distinct database name when the mocked flag is set', () => {
    ;(globalThis as { __LOGBOOK_MOCKED__?: boolean }).__LOGBOOK_MOCKED__ = true
    expect(getDbName()).not.toBe('logbook')
    expect(getDbName()).toBe('logbook-mocked')
  })
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
      const request = indexedDB.open(getDbName(), 1)
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

  it('keeps the mocked-run database separate from the real one, so sample entries seeded under `dev:mocked` never leak into a plain `dev` run', async () => {
    ;(globalThis as { __LOGBOOK_MOCKED__?: boolean }).__LOGBOOK_MOCKED__ = true
    const mockedDb = await openLogbookDb()
    await new Promise<void>((resolve, reject) => {
      const tx = mockedDb.transaction(ENTRIES_STORE, 'readwrite')
      tx.objectStore(ENTRIES_STORE).put({ id: 1, title: 'Sample entry' })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    mockedDb.close()

    delete (globalThis as { __LOGBOOK_MOCKED__?: boolean }).__LOGBOOK_MOCKED__
    const realDb = await openLogbookDb()
    try {
      const entries = await new Promise<unknown[]>((resolve, reject) => {
        const request = realDb.transaction(ENTRIES_STORE, 'readonly').objectStore(ENTRIES_STORE).getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      expect(entries).toEqual([])
    } finally {
      realDb.close()
    }
  })

  it('rejects with the request error when the open request itself errors', async () => {
    // Real IndexedDB engines rarely fail an `open()` call outright, but the
    // wiring (`request.onerror = () => reject(request.error)`) still needs
    // coverage. Swap in a minimal fake factory that fires `onerror`.
    const fakeError = new Error('open failed')
    const fakeRequest: { onerror?: () => void; error?: unknown } = {}
    globalThis.indexedDB = {
      open: () => {
        queueMicrotask(() => {
          fakeRequest.error = fakeError
          fakeRequest.onerror?.()
        })
        return fakeRequest
      },
    } as unknown as IDBFactory

    await expect(openLogbookDb()).rejects.toBe(fakeError)
  })
})

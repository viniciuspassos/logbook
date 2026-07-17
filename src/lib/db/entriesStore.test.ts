// A real IndexedDB is required to exercise the store. jsdom has none, so this
// suite installs the `fake-indexeddb` polyfill for its own module scope only —
// the global default elsewhere stays "unsupported" (real jsdom `undefined`).
// fake-indexeddb clones records via structuredClone, which this jsdom env
// lacks; entries are plain JSON, so a JSON round-trip stands in for it.
function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = jsonClone
}
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import {
  deleteEntry,
  getAllEntries,
  isPersistenceSupported,
  putEntries,
  putEntry,
  replaceAllEntries,
} from './entriesStore.ts'
import type { Entry } from '../../types/entry.ts'

function makeEntry(overrides: Partial<Entry> & { id: number }): Entry {
  return {
    title: `Entry ${overrides.id}`,
    shape: 'triangle',
    location: 'Somewhere',
    date: 'Jul 3',
    metric: '1,000m',
    excerpt: 'An excerpt.',
    weather: 'Clear',
    duration: '1 day',
    difficulty: 'Moderate',
    equipment: 'Boots',
    participants: 'Solo',
    raw: 'raw notes',
    story: 'A story.',
    photoHint: 'hint',
    media: ['a', 'b', 'c'],
    mapX: 50,
    mapY: 50,
    ...overrides,
  }
}

beforeEach(() => {
  // Fresh database per test so cases don't leak rows into each other.
  globalThis.indexedDB = new IDBFactory()
})

describe('entriesStore', () => {
  it('reports persistence support when indexedDB exists', () => {
    expect(isPersistenceSupported()).toBe(true)
  })

  it('returns an empty list from a fresh database', async () => {
    expect(await getAllEntries()).toEqual([])
  })

  it('persists an entry and reads it back', async () => {
    await putEntry(makeEntry({ id: 1, title: 'Summit day' }))
    const all = await getAllEntries()
    expect(all).toHaveLength(1)
    expect(all[0].title).toBe('Summit day')
  })

  it('returns entries newest-first (descending id)', async () => {
    await putEntries([
      makeEntry({ id: 1 }),
      makeEntry({ id: 3 }),
      makeEntry({ id: 2 }),
    ])
    expect((await getAllEntries()).map((e) => e.id)).toEqual([3, 2, 1])
  })

  it('overwrites an entry with the same id (upsert)', async () => {
    await putEntry(makeEntry({ id: 1, title: 'First' }))
    await putEntry(makeEntry({ id: 1, title: 'Updated' }))
    const all = await getAllEntries()
    expect(all).toHaveLength(1)
    expect(all[0].title).toBe('Updated')
  })

  it('deletes an entry by id', async () => {
    await putEntries([makeEntry({ id: 1 }), makeEntry({ id: 2 })])
    await deleteEntry(1)
    expect((await getAllEntries()).map((e) => e.id)).toEqual([2])
  })

  it('bulk-put of an empty list is a no-op', async () => {
    await putEntries([])
    expect(await getAllEntries()).toEqual([])
  })

  describe('replaceAllEntries', () => {
    it('drops the previous entries and stores the new ones', async () => {
      await putEntries([makeEntry({ id: 1 }), makeEntry({ id: 2 })])
      await replaceAllEntries([makeEntry({ id: 9, title: 'Restored' })])

      const all = await getAllEntries()
      expect(all).toHaveLength(1)
      expect(all[0].title).toBe('Restored')
    })

    it('clears the store when restoring an empty backup', async () => {
      await putEntries([makeEntry({ id: 1 })])
      await replaceAllEntries([])
      expect(await getAllEntries()).toEqual([])
    })
  })
})

// --- failure paths ------------------------------------------------------------
//
// The happy paths above exercise real fake-indexeddb behaviour end to end, but
// fake-indexeddb has no supported way to force a transaction/request into an
// error or abort state. To cover that wiring (errors must reject the returned
// promise, not hang or throw unhandled) these tests swap `indexedDB.open` for
// a minimal hand-built fake whose transaction/request objects we can fail on
// demand, the same pattern used in database.test.ts.

interface FakeRequest {
  onsuccess?: () => void
  onerror?: () => void
  result?: unknown
  error?: unknown
}

interface FakeTx {
  objectStore: () => { getAll: () => FakeRequest; put: () => void; delete: () => void }
  oncomplete?: () => void
  onerror?: () => void
  onabort?: () => void
  error?: unknown
}

/** Waits for `check` to become true, flushing the microtask queue between polls. */
async function waitUntil(check: () => boolean, attempts = 20): Promise<void> {
  for (let i = 0; i < attempts && !check(); i++) {
    await Promise.resolve()
  }
}

function installFakeIndexedDb(db: unknown): void {
  globalThis.indexedDB = {
    open: () => {
      const request: FakeRequest = {}
      queueMicrotask(() => {
        request.result = db
        request.onsuccess?.()
      })
      return request
    },
  } as unknown as IDBFactory
}

describe('write/read failure wiring', () => {
  it('rejects a write (e.g. putEntry) when the transaction errors', async () => {
    const txError = new Error('write failed')
    let tx: FakeTx | undefined
    const db = {
      transaction: () => {
        tx = { objectStore: () => ({ getAll: () => ({}), put: () => {}, delete: () => {} }) }
        return tx
      },
      close: jest.fn(),
    }
    installFakeIndexedDb(db)

    const pending = putEntry(makeEntry({ id: 1 }))
    await waitUntil(() => tx?.onerror !== undefined)
    tx!.error = txError
    tx!.onerror!()

    await expect(pending).rejects.toBe(txError)
    expect(db.close).toHaveBeenCalled()
  })

  it('rejects a write (e.g. putEntry) when the transaction aborts', async () => {
    const txError = new Error('write aborted')
    let tx: FakeTx | undefined
    const db = {
      transaction: () => {
        tx = { objectStore: () => ({ getAll: () => ({}), put: () => {}, delete: () => {} }) }
        return tx
      },
      close: jest.fn(),
    }
    installFakeIndexedDb(db)

    const pending = putEntry(makeEntry({ id: 1 }))
    await waitUntil(() => tx?.onabort !== undefined)
    tx!.error = txError
    tx!.onabort!()

    await expect(pending).rejects.toBe(txError)
  })

  it('rejects getAllEntries when the getAll request errors', async () => {
    const reqError = new Error('read failed')
    let request: FakeRequest | undefined
    const db = {
      transaction: () => ({
        objectStore: () => ({
          getAll: () => {
            request = {}
            return request
          },
        }),
      }),
      close: jest.fn(),
    }
    installFakeIndexedDb(db)

    const pending = getAllEntries()
    await waitUntil(() => request?.onerror !== undefined)
    request!.error = reqError
    request!.onerror!()

    await expect(pending).rejects.toBe(reqError)
  })
})

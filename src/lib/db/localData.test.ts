function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = jsonClone
}
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { clearLocalData, countOutbox, hasLocalData } from './localData.ts'
import { getAllEntries, putEntry } from './entriesStore.ts'
import { enqueueOperation, getAllRecords, markRejected } from './outboxStore.ts'
import { getSyncState, putSyncState } from './syncStateStore.ts'
import { getCachedAuthConfig, putCachedAuthConfig, putCachedIdentity, getCachedIdentity } from './identityStore.ts'
import type { Entry } from '../../types/entry.ts'

const entry = { id: 1, title: 'Old summit' } as Entry

async function seedLocalData() {
  await putEntry(entry)
  await enqueueOperation({ type: 'entry.create', localEntryId: 1 } as never)
  await putSyncState({ localEntryId: 1, serverId: 9, serverVersion: 1 })
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

describe('clearLocalData', () => {
  it('wipes entries, outbox and sync state', async () => {
    await seedLocalData()

    await clearLocalData()

    expect(await getAllEntries()).toEqual([])
    expect(await getAllRecords()).toEqual([])
    expect(await getSyncState(1)).toBeUndefined()
  })

  it('leaves the identity store alone (the caller decides what happens to the cached identity and config)', async () => {
    await putCachedIdentity({ id: 'u', email: 'a@b.co', name: null, picture: null })
    await putCachedAuthConfig({ methods: [] })

    await clearLocalData()

    expect(await getCachedIdentity()).not.toBeNull()
    expect(await getCachedAuthConfig()).toEqual({ methods: [] })
  })

  it.each(['onerror', 'onabort'] as const)('rejects when the clearing transaction fires %s', async (handler) => {
    await hasLocalData() // creates the database before the transaction is faked
    interface FakeTx {
      error: Error
      onerror?: () => void
      onabort?: () => void
      objectStore: () => { clear: () => void }
    }
    const spy = jest.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(() => {
      const tx: FakeTx = { error: new Error('boom'), objectStore: () => ({ clear: () => undefined }) }
      queueMicrotask(() => tx[handler]?.())
      return tx as unknown as IDBTransaction
    })
    try {
      await expect(clearLocalData()).rejects.toThrow('boom')
    } finally {
      spy.mockRestore()
    }
  })

  it('has nothing to wipe, and does not throw, when IndexedDB is unavailable', async () => {
    // @ts-expect-error simulating an environment without IndexedDB
    delete globalThis.indexedDB
    await expect(clearLocalData()).resolves.toBeUndefined()
  })
})

describe('hasLocalData', () => {
  it('is false for a brand-new device', async () => {
    expect(await hasLocalData()).toBe(false)
  })

  it('is true once there are entries', async () => {
    await putEntry(entry)
    expect(await hasLocalData()).toBe(true)
  })

  it('is true when IndexedDB is unavailable, so the user is never locked out blind', async () => {
    // @ts-expect-error simulating an environment without IndexedDB
    delete globalThis.indexedDB
    expect(await hasLocalData()).toBe(true)
  })

  it('is true when the store cannot be read', async () => {
    await hasLocalData() // creates the database before the transaction is faked
    const spy = jest.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(() => {
      throw new Error('boom')
    })
    try {
      expect(await hasLocalData()).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('countOutbox', () => {
  it('is zero on a fresh device', async () => {
    expect(await countOutbox()).toEqual({ retryable: 0, parked: 0 })
  })

  it('counts operations that can still sync apart from ones the server rejected for good', async () => {
    const first = await enqueueOperation({ kind: 'delete-entry', localEntryId: 1 } as never)
    await enqueueOperation({ kind: 'delete-entry', localEntryId: 2 } as never)
    await enqueueOperation({ kind: 'delete-entry', localEntryId: 3 } as never)
    await markRejected(first.queueId, 'too big')

    expect(await countOutbox()).toEqual({ retryable: 2, parked: 1 })
  })

  it('is zero, without throwing, when IndexedDB is unavailable (nothing can be queued)', async () => {
    // @ts-expect-error simulating an environment without IndexedDB
    delete globalThis.indexedDB
    expect(await countOutbox()).toEqual({ retryable: 0, parked: 0 })
  })
})

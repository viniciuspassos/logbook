function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = jsonClone
}
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { checkLocalOwner, claimLocalData, hasLocalData } from './localOwner.ts'
import { getLocalOwnerId, putLocalOwnerId } from './identityStore.ts'
import { getAllEntries, putEntry } from './entriesStore.ts'
import { enqueueOperation, getAllRecords } from './outboxStore.ts'
import { getSyncState, putSyncState } from './syncStateStore.ts'
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

describe('checkLocalOwner', () => {
  it('adopts the account when no owner is recorded yet (existing data belongs to the first user)', async () => {
    expect(await checkLocalOwner('u1')).toBe('ok')
    expect(await getLocalOwnerId()).toBe('u1')
  })

  it('is ok for the same account, whatever the id type', async () => {
    await putLocalOwnerId('7')
    expect(await checkLocalOwner(7)).toBe('ok')
  })

  it('reports a mismatch for a different account, without changing the owner', async () => {
    await putLocalOwnerId('u1')
    expect(await checkLocalOwner('u2')).toBe('mismatch')
    expect(await getLocalOwnerId()).toBe('u1')
  })
})

describe('claimLocalData', () => {
  it('wipes entries, outbox and sync state, then records the new owner', async () => {
    await seedLocalData()
    await putLocalOwnerId('u1')

    await claimLocalData('u2')

    expect(await getAllEntries()).toEqual([])
    expect(await getAllRecords()).toEqual([])
    expect(await getSyncState(1)).toBeUndefined()
    expect(await getLocalOwnerId()).toBe('u2')
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
      await expect(claimLocalData('u2')).rejects.toThrow('boom')
      expect(await getLocalOwnerId()).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })

  it('rejects, and does not record the owner, when the data cannot be cleared', async () => {
    // @ts-expect-error simulating an environment without IndexedDB
    delete globalThis.indexedDB
    await expect(claimLocalData('u2')).rejects.toBeDefined()
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

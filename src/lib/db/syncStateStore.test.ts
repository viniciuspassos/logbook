function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = jsonClone
}
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { deleteSyncState, getSyncState, putSyncState } from './syncStateStore.ts'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

describe('getSyncState', () => {
  it('returns undefined for an entry that has never synced', async () => {
    expect(await getSyncState(1)).toBeUndefined()
  })

  it('returns the stored state for a synced entry', async () => {
    await putSyncState({ localEntryId: 1, serverId: 42, serverVersion: 1 })
    expect(await getSyncState(1)).toEqual({ localEntryId: 1, serverId: 42, serverVersion: 1 })
  })
})

describe('putSyncState', () => {
  it('upserts (overwrites) the state for the same localEntryId', async () => {
    await putSyncState({ localEntryId: 1, serverId: 42, serverVersion: 1 })
    await putSyncState({ localEntryId: 1, serverId: 42, serverVersion: 2 })
    expect(await getSyncState(1)).toEqual({ localEntryId: 1, serverId: 42, serverVersion: 2 })
  })

  it('keeps state for different entries independent', async () => {
    await putSyncState({ localEntryId: 1, serverId: 42, serverVersion: 1 })
    await putSyncState({ localEntryId: 2, serverId: 43, serverVersion: 1 })
    expect(await getSyncState(1)).toMatchObject({ serverId: 42 })
    expect(await getSyncState(2)).toMatchObject({ serverId: 43 })
  })
})

describe('deleteSyncState', () => {
  it('removes the mapping for an entry', async () => {
    await putSyncState({ localEntryId: 1, serverId: 42, serverVersion: 1 })
    await deleteSyncState(1)
    expect(await getSyncState(1)).toBeUndefined()
  })

  it('is a no-op when there is nothing to delete', async () => {
    await expect(deleteSyncState(999)).resolves.toBeUndefined()
  })
})

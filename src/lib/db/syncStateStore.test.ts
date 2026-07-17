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

// --- failure paths ------------------------------------------------------------
//
// fake-indexeddb has no supported way to force a transaction/request into an
// error or abort state, so these tests swap `indexedDB.open` for a minimal
// hand-built fake whose transaction/request objects we can fail on demand —
// the same pattern used in database.test.ts / entriesStore.test.ts.

interface FakeRequest {
  onsuccess?: () => void
  onerror?: () => void
  result?: unknown
  error?: unknown
}

interface FakeTx {
  objectStore: () => { get?: () => FakeRequest; put?: () => void; delete?: () => void }
  oncomplete?: () => void
  onerror?: () => void
  onabort?: () => void
  error?: unknown
}

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
  it('rejects a runWrite call (e.g. putSyncState) when the transaction errors', async () => {
    const txError = new Error('write failed')
    let tx: FakeTx | undefined
    const db = {
      transaction: () => {
        tx = { objectStore: () => ({ put: () => {} }) }
        return tx
      },
      close: jest.fn(),
    }
    installFakeIndexedDb(db)

    const pending = putSyncState({ localEntryId: 1, serverId: 1, serverVersion: 1 })
    await waitUntil(() => tx?.onerror !== undefined)
    tx!.error = txError
    tx!.onerror!()

    await expect(pending).rejects.toBe(txError)
    expect(db.close).toHaveBeenCalled()
  })

  it('rejects a runWrite call (e.g. putSyncState) when the transaction aborts', async () => {
    const txError = new Error('write aborted')
    let tx: FakeTx | undefined
    const db = {
      transaction: () => {
        tx = { objectStore: () => ({ put: () => {} }) }
        return tx
      },
      close: jest.fn(),
    }
    installFakeIndexedDb(db)

    const pending = putSyncState({ localEntryId: 1, serverId: 1, serverVersion: 1 })
    await waitUntil(() => tx?.onabort !== undefined)
    tx!.error = txError
    tx!.onabort!()

    await expect(pending).rejects.toBe(txError)
  })

  it('rejects getSyncState when the get request errors', async () => {
    const reqError = new Error('get failed')
    let request: FakeRequest | undefined
    const db = {
      transaction: () => ({
        objectStore: () => ({
          get: () => {
            request = {}
            return request
          },
        }),
      }),
      close: jest.fn(),
    }
    installFakeIndexedDb(db)

    const pending = getSyncState(1)
    await waitUntil(() => request?.onerror !== undefined)
    request!.error = reqError
    request!.onerror!()

    await expect(pending).rejects.toBe(reqError)
  })
})

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = jsonClone
}
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { enqueueOperation, getAllRecords, recordAttemptFailure, removeRecord } from './outboxStore.ts'
import type { CreateEntryOperation, UploadAttachmentOperation } from '../../types/outbox.ts'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

function createOp(localEntryId = 1): CreateEntryOperation {
  return {
    kind: 'create-entry',
    localEntryId,
    payload: {
      title: 'Summit day',
      shape: 'triangle',
      location: 'Alps',
      date: 'Jul 3',
      metric: '3000m',
      excerpt: '',
      weather: 'Clear',
      duration: '6h',
      difficulty: 'Moderate',
      equipment: 'Ropes',
      participants: 'Solo',
      raw: 'raw notes',
      story: 'A story.',
      photoHint: 'hint',
      media: ['a', 'b', 'c'],
      mapX: 50,
      mapY: 50,
    },
  }
}

describe('enqueueOperation', () => {
  it('assigns an autoincrement queueId, attempts=0 and a createdAt timestamp', async () => {
    const record = await enqueueOperation(createOp())
    expect(record.queueId).toBe(1)
    expect(record.attempts).toBe(0)
    expect(record.lastError).toBeUndefined()
    expect(typeof record.createdAt).toBe('string')
    expect(record.operation).toEqual(createOp())
  })

  it('assigns increasing queueIds across multiple enqueues', async () => {
    const first = await enqueueOperation(createOp(1))
    const second = await enqueueOperation(createOp(2))
    expect(second.queueId).toBeGreaterThan(first.queueId)
  })
})

describe('getAllRecords', () => {
  it('returns an empty list from a fresh queue', async () => {
    expect(await getAllRecords()).toEqual([])
  })

  it('returns records in FIFO (ascending queueId) order', async () => {
    await enqueueOperation(createOp(1))
    await enqueueOperation(createOp(2))
    await enqueueOperation(createOp(3))
    const all = await getAllRecords()
    expect(all.map((r) => r.operation.localEntryId)).toEqual([1, 2, 3])
  })

  it('round-trips a Blob payload (attachment upload operation)', async () => {
    const op: UploadAttachmentOperation = {
      kind: 'upload-attachment',
      localEntryId: 1,
      file: new Blob(['bytes'], { type: 'image/jpeg' }),
      filename: 'summit.jpg',
    }
    await enqueueOperation(op)
    const [record] = await getAllRecords()
    expect(record.operation.kind).toBe('upload-attachment')
  })
})

describe('removeRecord', () => {
  it('removes a queued operation by queueId', async () => {
    const record = await enqueueOperation(createOp())
    await removeRecord(record.queueId)
    expect(await getAllRecords()).toEqual([])
  })

  it('is a no-op when the queueId does not exist', async () => {
    await expect(removeRecord(999)).resolves.toBeUndefined()
  })
})

describe('recordAttemptFailure', () => {
  it('increments attempts and stores the error message', async () => {
    const record = await enqueueOperation(createOp())
    await recordAttemptFailure(record.queueId, 'Could not reach the server.')
    const [updated] = await getAllRecords()
    expect(updated.attempts).toBe(1)
    expect(updated.lastError).toBe('Could not reach the server.')
  })

  it('is a no-op when the record was already removed', async () => {
    await expect(recordAttemptFailure(999, 'gone')).resolves.toBeUndefined()
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
  objectStore: () => {
    add?: () => FakeRequest
    get?: () => FakeRequest
    getAll?: () => FakeRequest
    put?: () => void
    delete?: () => void
  }
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
  it('rejects a runWrite call (e.g. removeRecord) when the transaction errors', async () => {
    const txError = new Error('write failed')
    let tx: FakeTx | undefined
    const db = {
      transaction: () => {
        tx = { objectStore: () => ({ delete: () => {} }) }
        return tx
      },
      close: jest.fn(),
    }
    installFakeIndexedDb(db)

    const pending = removeRecord(1)
    await waitUntil(() => tx?.onerror !== undefined)
    tx!.error = txError
    tx!.onerror!()

    await expect(pending).rejects.toBe(txError)
    expect(db.close).toHaveBeenCalled()
  })

  it('rejects a runWrite call (e.g. removeRecord) when the transaction aborts', async () => {
    const txError = new Error('write aborted')
    let tx: FakeTx | undefined
    const db = {
      transaction: () => {
        tx = { objectStore: () => ({ delete: () => {} }) }
        return tx
      },
      close: jest.fn(),
    }
    installFakeIndexedDb(db)

    const pending = removeRecord(1)
    await waitUntil(() => tx?.onabort !== undefined)
    tx!.error = txError
    tx!.onabort!()

    await expect(pending).rejects.toBe(txError)
  })

  it('rejects enqueueOperation when the add request errors', async () => {
    const reqError = new Error('add failed')
    let request: FakeRequest | undefined
    const db = {
      transaction: () => ({
        objectStore: () => ({
          add: () => {
            request = {}
            return request
          },
        }),
      }),
      close: jest.fn(),
    }
    installFakeIndexedDb(db)

    const pending = enqueueOperation(createOp())
    await waitUntil(() => request?.onerror !== undefined)
    request!.error = reqError
    request!.onerror!()

    await expect(pending).rejects.toBe(reqError)
  })

  it('rejects getAllRecords when the getAll request errors', async () => {
    const reqError = new Error('getAll failed')
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

    const pending = getAllRecords()
    await waitUntil(() => request?.onerror !== undefined)
    request!.error = reqError
    request!.onerror!()

    await expect(pending).rejects.toBe(reqError)
  })

  it('rejects recordAttemptFailure when the lookup (get) request errors', async () => {
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

    const pending = recordAttemptFailure(1, 'boom')
    await waitUntil(() => request?.onerror !== undefined)
    request!.error = reqError
    request!.onerror!()

    await expect(pending).rejects.toBe(reqError)
  })
})

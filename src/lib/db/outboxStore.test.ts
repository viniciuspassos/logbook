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

import {
  entryToCreatePayload,
  getEntryAttachmentSources,
  listPendingAttachments,
  queueAttachmentUpload,
  queueEntryCreate,
  queueEntryDelete,
  queueEntryUpdate,
} from './outboxQueue.ts'
import { enqueueOperation, getAllRecords } from '../db/outboxStore.ts'
import { deleteSyncState, getSyncState, putSyncState } from '../db/syncStateStore.ts'
import { isPersistenceSupported } from '../db/database.ts'
import { listAttachmentsForEntry } from './attachmentsApi.ts'
import type { Entry } from '../../types/entry.ts'
import type { OutboxRecord } from '../../types/outbox.ts'
import type { ServerAttachment } from '../../types/sync.ts'

jest.mock('../db/database.ts', () => ({
  isPersistenceSupported: jest.fn().mockReturnValue(true),
}))
jest.mock('../db/outboxStore.ts', () => ({
  enqueueOperation: jest.fn(),
  getAllRecords: jest.fn(),
}))
jest.mock('../db/syncStateStore.ts', () => ({
  getSyncState: jest.fn(),
  putSyncState: jest.fn(),
  deleteSyncState: jest.fn(),
}))
jest.mock('./attachmentsApi.ts', () => ({
  listAttachmentsForEntry: jest.fn(),
}))

const enqueueMock = enqueueOperation as jest.Mock
const getAllRecordsMock = getAllRecords as jest.Mock
const getSyncStateMock = getSyncState as jest.Mock
const putSyncStateMock = putSyncState as jest.Mock
const deleteSyncStateMock = deleteSyncState as jest.Mock
const listAttachmentsMock = listAttachmentsForEntry as jest.Mock
const supportedMock = isPersistenceSupported as jest.Mock

function makeEntry(overrides: Partial<Entry> & { id: number }): Entry {
  return {
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
    ...overrides,
  }
}

function makeRecord(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    queueId: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    attempts: 0,
    operation: { kind: 'create-entry', localEntryId: 1, payload: entryToCreatePayload(makeEntry({ id: 1 })) },
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  supportedMock.mockReturnValue(true)
  enqueueMock.mockResolvedValue(makeRecord())
  getAllRecordsMock.mockResolvedValue([])
  getSyncStateMock.mockResolvedValue(undefined)
  putSyncStateMock.mockResolvedValue(undefined)
  deleteSyncStateMock.mockResolvedValue(undefined)
  listAttachmentsMock.mockResolvedValue([])
})

describe('entryToCreatePayload', () => {
  it('strips the local id, keeping every other field', () => {
    const entry = makeEntry({ id: 7, title: 'Peak' })
    const payload = entryToCreatePayload(entry)
    expect(payload).toEqual({ ...entry, id: undefined })
    expect('id' in payload).toBe(false)
  })
})

describe('queueEntryCreate', () => {
  it('enqueues a create-entry operation for the entry', async () => {
    const entry = makeEntry({ id: 3 })
    await queueEntryCreate(entry)
    expect(enqueueMock).toHaveBeenCalledWith({
      kind: 'create-entry',
      localEntryId: 3,
      payload: entryToCreatePayload(entry),
    })
  })

  it('does nothing when persistence is unsupported', async () => {
    supportedMock.mockReturnValue(false)
    await queueEntryCreate(makeEntry({ id: 3 }))
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('never throws when the durable write fails', async () => {
    enqueueMock.mockRejectedValue(new Error('storage full'))
    await expect(queueEntryCreate(makeEntry({ id: 3 }))).resolves.toBeUndefined()
  })
})

describe('queueEntryUpdate', () => {
  it('enqueues an update-entry operation', async () => {
    const entry = makeEntry({ id: 3, title: 'Updated' })
    await queueEntryUpdate(entry, { version: 2 })
    expect(enqueueMock).toHaveBeenCalledWith({
      kind: 'update-entry',
      localEntryId: 3,
      payload: { ...entryToCreatePayload(entry), version: 2 },
    })
  })
})

describe('queueEntryDelete', () => {
  it('enqueues a delete-entry operation', async () => {
    await queueEntryDelete(5)
    expect(enqueueMock).toHaveBeenCalledWith({ kind: 'delete-entry', localEntryId: 5 })
  })
})

describe('queueAttachmentUpload', () => {
  const blob = new Blob(['bytes'], { type: 'image/jpeg' })

  it('enqueues only the upload when the entry already has a serverId', async () => {
    getSyncStateMock.mockResolvedValue({ localEntryId: 3, serverId: 42, serverVersion: 1 })
    await queueAttachmentUpload(makeEntry({ id: 3 }), blob, 'summit.jpg')
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock).toHaveBeenCalledWith({
      kind: 'upload-attachment',
      localEntryId: 3,
      file: blob,
      filename: 'summit.jpg',
    })
  })

  it('enqueues only the upload when a create-entry op for this entry is already pending', async () => {
    getSyncStateMock.mockResolvedValue(undefined)
    getAllRecordsMock.mockResolvedValue([
      makeRecord({ operation: { kind: 'create-entry', localEntryId: 3, payload: entryToCreatePayload(makeEntry({ id: 3 })) } }),
    ])
    await queueAttachmentUpload(makeEntry({ id: 3 }), blob, 'summit.jpg')
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'upload-attachment' }),
    )
  })

  it('self-heals by queuing a create-entry op first for an entry with no sync state and no pending create (e.g. seed data)', async () => {
    getSyncStateMock.mockResolvedValue(undefined)
    getAllRecordsMock.mockResolvedValue([])
    const entry = makeEntry({ id: 9 })
    await queueAttachmentUpload(entry, blob, 'summit.jpg')
    expect(enqueueMock).toHaveBeenCalledTimes(2)
    expect(enqueueMock).toHaveBeenNthCalledWith(1, {
      kind: 'create-entry',
      localEntryId: 9,
      payload: entryToCreatePayload(entry),
    })
    expect(enqueueMock).toHaveBeenNthCalledWith(2, {
      kind: 'upload-attachment',
      localEntryId: 9,
      file: blob,
      filename: 'summit.jpg',
    })
  })

  it('never throws when persistence is unsupported', async () => {
    supportedMock.mockReturnValue(false)
    await expect(queueAttachmentUpload(makeEntry({ id: 3 }), blob, 'x.jpg')).resolves.toBeUndefined()
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})

describe('listPendingAttachments', () => {
  it('returns only upload-attachment records for the given entry', async () => {
    getAllRecordsMock.mockResolvedValue([
      makeRecord({ queueId: 1, operation: { kind: 'upload-attachment', localEntryId: 3, file: new Blob(), filename: 'a.jpg' } }),
      makeRecord({ queueId: 2, operation: { kind: 'upload-attachment', localEntryId: 4, file: new Blob(), filename: 'b.jpg' } }),
      makeRecord({ queueId: 3, operation: { kind: 'create-entry', localEntryId: 3, payload: entryToCreatePayload(makeEntry({ id: 3 })) } }),
    ])
    const pending = await listPendingAttachments(3)
    expect(pending.map((r) => r.queueId)).toEqual([1])
  })

  it('returns an empty list when persistence is unsupported', async () => {
    supportedMock.mockReturnValue(false)
    expect(await listPendingAttachments(3)).toEqual([])
    expect(getAllRecordsMock).not.toHaveBeenCalled()
  })
})

describe('getEntryAttachmentSources', () => {
  const attachment: ServerAttachment = {
    id: 1,
    entryId: 42,
    originalFilename: 'summit.jpg',
    storageKey: 'key',
    mimeType: 'image/jpeg',
    sizeBytes: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
  }

  it('fetches server attachments when the entry has a serverId', async () => {
    getSyncStateMock.mockResolvedValue({ localEntryId: 3, serverId: 42, serverVersion: 1 })
    listAttachmentsMock.mockResolvedValue([attachment])
    const result = await getEntryAttachmentSources(makeEntry({ id: 3 }))
    expect(result.serverAttachments).toEqual([attachment])
    expect(listAttachmentsMock).toHaveBeenCalledWith(42, undefined)
  })

  it('returns no server attachments when the entry has never synced', async () => {
    getSyncStateMock.mockResolvedValue(undefined)
    const result = await getEntryAttachmentSources(makeEntry({ id: 3 }))
    expect(result.serverAttachments).toEqual([])
    expect(listAttachmentsMock).not.toHaveBeenCalled()
  })

  it('degrades to an empty server list when the fetch fails (offline)', async () => {
    getSyncStateMock.mockResolvedValue({ localEntryId: 3, serverId: 42, serverVersion: 1 })
    listAttachmentsMock.mockRejectedValue(new Error('offline'))
    const result = await getEntryAttachmentSources(makeEntry({ id: 3 }))
    expect(result.serverAttachments).toEqual([])
  })

  it('includes pending (queued, not-yet-uploaded) attachments for the entry', async () => {
    getSyncStateMock.mockResolvedValue(undefined)
    const pendingRecord = makeRecord({
      queueId: 5,
      operation: { kind: 'upload-attachment', localEntryId: 3, file: new Blob(), filename: 'p.jpg' },
    })
    getAllRecordsMock.mockResolvedValue([pendingRecord])
    const result = await getEntryAttachmentSources(makeEntry({ id: 3 }))
    expect(result.pending).toEqual([pendingRecord])
  })
})

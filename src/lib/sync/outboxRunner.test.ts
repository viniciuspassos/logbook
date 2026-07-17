import { drainOutbox, startAutoSync } from './outboxRunner.ts'
import { getAllRecords, recordAttemptFailure, removeRecord } from '../db/outboxStore.ts'
import { deleteSyncState, getSyncState, putSyncState } from '../db/syncStateStore.ts'
import { isPersistenceSupported } from '../db/database.ts'
import { isBackendReachable } from './health.ts'
import { createEntry, deleteEntry, updateEntry } from './entriesApi.ts'
import { uploadAttachment } from './attachmentsApi.ts'
import type { OutboxRecord } from '../../types/outbox.ts'
import type { CreateEntryPayload, ServerEntry } from '../../types/sync.ts'

jest.mock('../db/database.ts', () => ({ isPersistenceSupported: jest.fn().mockReturnValue(true) }))
jest.mock('../db/outboxStore.ts', () => ({
  getAllRecords: jest.fn(),
  removeRecord: jest.fn(),
  recordAttemptFailure: jest.fn(),
}))
jest.mock('../db/syncStateStore.ts', () => ({
  getSyncState: jest.fn(),
  putSyncState: jest.fn(),
  deleteSyncState: jest.fn(),
}))
jest.mock('./health.ts', () => ({ isBackendReachable: jest.fn() }))
jest.mock('./entriesApi.ts', () => ({
  createEntry: jest.fn(),
  updateEntry: jest.fn(),
  deleteEntry: jest.fn(),
}))
jest.mock('./attachmentsApi.ts', () => ({ uploadAttachment: jest.fn() }))

const supportedMock = isPersistenceSupported as jest.Mock
const reachableMock = isBackendReachable as jest.Mock
const getAllRecordsMock = getAllRecords as jest.Mock
const removeRecordMock = removeRecord as jest.Mock
const recordFailureMock = recordAttemptFailure as jest.Mock
const getSyncStateMock = getSyncState as jest.Mock
const putSyncStateMock = putSyncState as jest.Mock
const deleteSyncStateMock = deleteSyncState as jest.Mock
const createEntryMock = createEntry as jest.Mock
const updateEntryMock = updateEntry as jest.Mock
const deleteEntryMock = deleteEntry as jest.Mock
const uploadAttachmentMock = uploadAttachment as jest.Mock

const payload = {} as CreateEntryPayload

function createRecord(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    queueId: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    attempts: 0,
    operation: { kind: 'create-entry', localEntryId: 1, payload },
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  supportedMock.mockReturnValue(true)
  reachableMock.mockResolvedValue(true)
  getAllRecordsMock.mockResolvedValue([])
  removeRecordMock.mockResolvedValue(undefined)
  recordFailureMock.mockResolvedValue(undefined)
  getSyncStateMock.mockResolvedValue(undefined)
  putSyncStateMock.mockResolvedValue(undefined)
  deleteSyncStateMock.mockResolvedValue(undefined)
})

describe('drainOutbox', () => {
  it('does nothing when the backend is unreachable', async () => {
    reachableMock.mockResolvedValue(false)
    const summary = await drainOutbox()
    expect(summary).toEqual({ processed: 0, stoppedReason: 'unreachable' })
    expect(getAllRecordsMock).not.toHaveBeenCalled()
  })

  it('does nothing when the queue is empty', async () => {
    getAllRecordsMock.mockResolvedValue([])
    const summary = await drainOutbox()
    expect(summary).toEqual({ processed: 0, stoppedReason: 'empty' })
  })

  it('does nothing when persistence is unsupported', async () => {
    supportedMock.mockReturnValue(false)
    const summary = await drainOutbox()
    expect(summary.stoppedReason).toBe('unsupported')
    expect(reachableMock).not.toHaveBeenCalled()
  })

  describe('create-entry', () => {
    it('POSTs the payload and records the resulting server id + version', async () => {
      const created: ServerEntry = { ...(payload as unknown as ServerEntry), id: 42, version: 1 }
      createEntryMock.mockResolvedValue(created)
      getAllRecordsMock.mockResolvedValue([createRecord()])

      const summary = await drainOutbox()

      expect(createEntryMock).toHaveBeenCalledWith(payload, undefined)
      expect(putSyncStateMock).toHaveBeenCalledWith({ localEntryId: 1, serverId: 42, serverVersion: 1 })
      expect(removeRecordMock).toHaveBeenCalledWith(1)
      expect(summary).toEqual({ processed: 1, stoppedReason: 'empty' })
    })

    it('skips the network call when the entry already has a serverId (idempotent retry)', async () => {
      getSyncStateMock.mockResolvedValue({ localEntryId: 1, serverId: 42, serverVersion: 1 })
      getAllRecordsMock.mockResolvedValue([createRecord()])

      await drainOutbox()

      expect(createEntryMock).not.toHaveBeenCalled()
      expect(removeRecordMock).toHaveBeenCalledWith(1)
    })
  })

  describe('update-entry', () => {
    it('stops the drain when the entry has not synced yet (create still ahead of it)', async () => {
      getAllRecordsMock.mockResolvedValue([
        createRecord({ operation: { kind: 'update-entry', localEntryId: 1, payload: { version: 1 } } }),
      ])

      const summary = await drainOutbox()

      expect(updateEntryMock).not.toHaveBeenCalled()
      expect(summary.stoppedReason).toBe('error')
      expect(recordFailureMock).toHaveBeenCalledWith(1, expect.any(String))
    })

    it('PATCHes using the mapped serverId and records the new version', async () => {
      getSyncStateMock.mockResolvedValue({ localEntryId: 1, serverId: 42, serverVersion: 1 })
      updateEntryMock.mockResolvedValue({ id: 42, version: 2 })
      getAllRecordsMock.mockResolvedValue([
        createRecord({ operation: { kind: 'update-entry', localEntryId: 1, payload: { version: 1 } } }),
      ])

      await drainOutbox()

      expect(updateEntryMock).toHaveBeenCalledWith(42, { version: 1 }, undefined)
      expect(putSyncStateMock).toHaveBeenCalledWith({ localEntryId: 1, serverId: 42, serverVersion: 2 })
      expect(removeRecordMock).toHaveBeenCalledWith(1)
    })
  })

  describe('delete-entry', () => {
    it('is a no-op removal when the entry never synced', async () => {
      getAllRecordsMock.mockResolvedValue([
        createRecord({ operation: { kind: 'delete-entry', localEntryId: 1 } }),
      ])

      await drainOutbox()

      expect(deleteEntryMock).not.toHaveBeenCalled()
      expect(removeRecordMock).toHaveBeenCalledWith(1)
    })

    it('DELETEs using the mapped serverId and clears the sync state', async () => {
      getSyncStateMock.mockResolvedValue({ localEntryId: 1, serverId: 42, serverVersion: 1 })
      getAllRecordsMock.mockResolvedValue([
        createRecord({ operation: { kind: 'delete-entry', localEntryId: 1 } }),
      ])

      await drainOutbox()

      expect(deleteEntryMock).toHaveBeenCalledWith(42, undefined)
      expect(deleteSyncStateMock).toHaveBeenCalledWith(1)
      expect(removeRecordMock).toHaveBeenCalledWith(1)
    })
  })

  describe('upload-attachment', () => {
    const blob = new Blob(['x'])

    it('stops the drain when the entry has not synced yet', async () => {
      getAllRecordsMock.mockResolvedValue([
        createRecord({ operation: { kind: 'upload-attachment', localEntryId: 1, file: blob, filename: 'a.jpg' } }),
      ])

      const summary = await drainOutbox()

      expect(uploadAttachmentMock).not.toHaveBeenCalled()
      expect(summary.stoppedReason).toBe('error')
    })

    it('uploads using the mapped serverId', async () => {
      getSyncStateMock.mockResolvedValue({ localEntryId: 1, serverId: 42, serverVersion: 1 })
      getAllRecordsMock.mockResolvedValue([
        createRecord({ operation: { kind: 'upload-attachment', localEntryId: 1, file: blob, filename: 'a.jpg' } }),
      ])

      await drainOutbox()

      expect(uploadAttachmentMock).toHaveBeenCalledWith(42, blob, 'a.jpg', undefined)
      expect(removeRecordMock).toHaveBeenCalledWith(1)
    })
  })

  it('stops at the first failure and never attempts later ops in the same pass', async () => {
    createEntryMock.mockRejectedValue(new Error('server exploded'))
    getAllRecordsMock.mockResolvedValue([
      createRecord({ queueId: 1 }),
      createRecord({
        queueId: 2,
        operation: { kind: 'upload-attachment', localEntryId: 1, file: new Blob(), filename: 'a.jpg' },
      }),
    ])

    const summary = await drainOutbox()

    expect(uploadAttachmentMock).not.toHaveBeenCalled()
    expect(recordFailureMock).toHaveBeenCalledWith(1, 'server exploded')
    expect(summary).toEqual({ processed: 0, stoppedReason: 'error', error: 'server exploded' })
  })

  it('stops mid-drain when the signal is aborted before a record is processed', async () => {
    const controller = new AbortController()
    getAllRecordsMock.mockResolvedValue([
      createRecord({ queueId: 1 }),
      createRecord({ queueId: 2 }),
    ])
    createEntryMock.mockImplementation(() => {
      controller.abort()
      return Promise.resolve({ id: 42, version: 1 })
    })

    const summary = await drainOutbox(controller.signal)

    expect(summary).toEqual({ processed: 1, stoppedReason: 'aborted' })
    expect(removeRecordMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to a generic message when the failure is not an Error instance', async () => {
    createEntryMock.mockRejectedValue('a raw string rejection')
    getAllRecordsMock.mockResolvedValue([createRecord({ queueId: 1 })])

    const summary = await drainOutbox()

    expect(summary).toEqual({ processed: 0, stoppedReason: 'error', error: 'Unknown sync error.' })
  })

  it('reports an error summary (rather than throwing) when reading the queue itself fails', async () => {
    getAllRecordsMock.mockRejectedValue(new Error('indexeddb read failed'))

    const summary = await drainOutbox()

    expect(summary).toEqual({ processed: 0, stoppedReason: 'error', error: 'indexeddb read failed' })
  })

  it('still reports the original failure even when recording the attempt failure itself fails', async () => {
    createEntryMock.mockRejectedValue(new Error('server exploded'))
    recordFailureMock.mockRejectedValue(new Error('db write failed'))
    getAllRecordsMock.mockResolvedValue([createRecord({ queueId: 1 })])

    const summary = await drainOutbox()

    expect(recordFailureMock).toHaveBeenCalledWith(1, 'server exploded')
    expect(summary).toEqual({ processed: 0, stoppedReason: 'error', error: 'server exploded' })
  })

  it('shares one in-flight drain across concurrent callers instead of racing', async () => {
    let resolveReachable: ((value: boolean) => void) | undefined
    reachableMock.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveReachable = resolve
      }),
    )

    const first = drainOutbox()
    const second = drainOutbox()
    resolveReachable?.(false)

    await expect(first).resolves.toEqual({ processed: 0, stoppedReason: 'unreachable' })
    await expect(second).resolves.toEqual({ processed: 0, stoppedReason: 'unreachable' })
    expect(reachableMock).toHaveBeenCalledTimes(1)
  })
})

describe('startAutoSync', () => {
  it('drains the outbox when the browser comes back online', () => {
    getAllRecordsMock.mockResolvedValue([])
    const stop = startAutoSync()
    try {
      window.dispatchEvent(new Event('online'))
      expect(reachableMock).toHaveBeenCalled()
    } finally {
      stop()
    }
  })

  it('returns a cleanup function that stops listening', () => {
    const stop = startAutoSync()
    stop()
    reachableMock.mockClear()
    window.dispatchEvent(new Event('online'))
    expect(reachableMock).not.toHaveBeenCalled()
  })

  // The `typeof window === 'undefined'` (SSR) branch can't be exercised here:
  // jsdom's `window` global is non-configurable, so it can't be deleted or
  // stubbed from within a jsdom test. See outboxRunner.ssr.test.ts, which runs
  // under Jest's `node` environment where `window` is genuinely absent.
})

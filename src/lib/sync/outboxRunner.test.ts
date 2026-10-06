import { drainOutbox, pauseDrains, resumeDrains, startAutoSync, subscribeToDrains } from './outboxRunner.ts'
import { getAllRecords, hasRecord, markRejected, recordAttemptFailure, removeRecord } from '../db/outboxStore.ts'
import { deleteSyncState, getSyncState, putSyncState } from '../db/syncStateStore.ts'
import { isPersistenceSupported } from '../db/database.ts'
import { isBackendReachable } from './health.ts'
import { createEntry, deleteEntry, updateEntry } from './entriesApi.ts'
import { deleteAttachment, uploadAttachment } from './attachmentsApi.ts'
import { SyncAuthError, SyncHttpError } from './errors.ts'
import type { OutboxRecord } from '../../types/outbox.ts'
import type { CreateEntryPayload, ServerEntry } from '../../types/sync.ts'

jest.mock('../db/database.ts', () => ({ isPersistenceSupported: jest.fn().mockReturnValue(true) }))
jest.mock('../db/outboxStore.ts', () => ({
  getAllRecords: jest.fn(),
  hasRecord: jest.fn(),
  removeRecord: jest.fn(),
  recordAttemptFailure: jest.fn(),
  markRejected: jest.fn(),
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
jest.mock('./attachmentsApi.ts', () => ({ uploadAttachment: jest.fn(), deleteAttachment: jest.fn() }))

const supportedMock = isPersistenceSupported as jest.Mock
const reachableMock = isBackendReachable as jest.Mock
const getAllRecordsMock = getAllRecords as jest.Mock
const removeRecordMock = removeRecord as jest.Mock
const hasRecordMock = hasRecord as jest.Mock
const recordFailureMock = recordAttemptFailure as jest.Mock
const markRejectedMock = markRejected as jest.Mock
const getSyncStateMock = getSyncState as jest.Mock
const putSyncStateMock = putSyncState as jest.Mock
const deleteSyncStateMock = deleteSyncState as jest.Mock
const createEntryMock = createEntry as jest.Mock
const updateEntryMock = updateEntry as jest.Mock
const deleteEntryMock = deleteEntry as jest.Mock
const uploadAttachmentMock = uploadAttachment as jest.Mock
const deleteAttachmentMock = deleteAttachment as jest.Mock

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
  hasRecordMock.mockResolvedValue(true)
  removeRecordMock.mockResolvedValue(undefined)
  recordFailureMock.mockResolvedValue(undefined)
  markRejectedMock.mockResolvedValue(undefined)
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

  it('skips a record removed from the queue since the pass read it (e.g. its entry was deleted)', async () => {
    hasRecordMock.mockResolvedValue(false)
    getAllRecordsMock.mockResolvedValue([createRecord()])

    const summary = await drainOutbox()

    expect(createEntryMock).not.toHaveBeenCalled()
    expect(removeRecordMock).not.toHaveBeenCalled()
    expect(summary).toEqual({ processed: 0, stoppedReason: 'empty' })
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

    it('treats a 404 as already deleted rather than stalling the queue', async () => {
      getSyncStateMock.mockResolvedValue({ localEntryId: 1, serverId: 42, serverVersion: 1 })
      deleteEntryMock.mockRejectedValue(new SyncHttpError(404, null, 'Not found'))
      getAllRecordsMock.mockResolvedValue([
        createRecord({ operation: { kind: 'delete-entry', localEntryId: 1 } }),
      ])

      const summary = await drainOutbox()

      expect(deleteSyncStateMock).toHaveBeenCalledWith(1)
      expect(removeRecordMock).toHaveBeenCalledWith(1)
      expect(summary).toEqual({ processed: 1, stoppedReason: 'empty' })
    })

    it('still stops the drain on any other HTTP error', async () => {
      getSyncStateMock.mockResolvedValue({ localEntryId: 1, serverId: 42, serverVersion: 1 })
      deleteEntryMock.mockRejectedValue(new SyncHttpError(500, null, 'Boom'))
      getAllRecordsMock.mockResolvedValue([
        createRecord({ operation: { kind: 'delete-entry', localEntryId: 1 } }),
      ])

      const summary = await drainOutbox()

      expect(removeRecordMock).not.toHaveBeenCalled()
      expect(summary).toEqual({ processed: 0, stoppedReason: 'error', error: 'Boom' })
    })
  })

  describe('delete-attachment', () => {
    const op = { kind: 'delete-attachment' as const, localEntryId: 1, serverAttachmentId: 7 }

    it('DELETEs the attachment by its server id', async () => {
      deleteAttachmentMock.mockResolvedValue(undefined)
      getAllRecordsMock.mockResolvedValue([createRecord({ operation: op })])

      const summary = await drainOutbox()

      expect(deleteAttachmentMock).toHaveBeenCalledWith(7, undefined)
      expect(removeRecordMock).toHaveBeenCalledWith(1)
      expect(summary).toEqual({ processed: 1, stoppedReason: 'empty' })
    })

    it('treats a 404 as already deleted', async () => {
      deleteAttachmentMock.mockRejectedValue(new SyncHttpError(404, null, 'Not found'))
      getAllRecordsMock.mockResolvedValue([createRecord({ operation: op })])

      const summary = await drainOutbox()

      expect(removeRecordMock).toHaveBeenCalledWith(1)
      expect(summary.stoppedReason).toBe('empty')
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
      expect(deleteAttachmentMock).not.toHaveBeenCalled()
    })

    it('deletes the upload again when the user removed the photo while it was uploading', async () => {
      getSyncStateMock.mockResolvedValue({ localEntryId: 1, serverId: 42, serverVersion: 1 })
      uploadAttachmentMock.mockResolvedValue({ id: 77 })
      deleteAttachmentMock.mockResolvedValue(undefined)
      // Still queued when the pass reaches it, gone once the upload returns.
      hasRecordMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
      getAllRecordsMock.mockResolvedValue([
        createRecord({ operation: { kind: 'upload-attachment', localEntryId: 1, file: blob, filename: 'a.jpg' } }),
      ])

      const summary = await drainOutbox()

      expect(deleteAttachmentMock).toHaveBeenCalledWith(77, undefined)
      expect(summary.stoppedReason).toBe('empty')
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

  it('stops with a dedicated "auth" reason (not the generic "error") when a record 401s', async () => {
    createEntryMock.mockRejectedValue(new SyncAuthError(401, null, 'Authentication required.'))
    getAllRecordsMock.mockResolvedValue([createRecord({ queueId: 1 })])

    const summary = await drainOutbox()

    expect(summary).toEqual({ processed: 0, stoppedReason: 'auth', error: 'Authentication required.' })
    expect(recordFailureMock).toHaveBeenCalledWith(1, 'Authentication required.')
  })

  it('also reports "auth" for a 403 (forbidden session), not just a 401', async () => {
    createEntryMock.mockRejectedValue(new SyncAuthError(403, null, 'Forbidden.'))
    getAllRecordsMock.mockResolvedValue([createRecord({ queueId: 1 })])

    const summary = await drainOutbox()

    expect(summary.stoppedReason).toBe('auth')
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

describe('drainOutbox called while a drain is already running', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  it('runs one more pass so work queued mid-drain is not reported as synced', async () => {
    const created: ServerEntry = { ...(payload as unknown as ServerEntry), id: 42, version: 1 }
    const firstCreate = deferred<ServerEntry>()
    createEntryMock.mockReturnValueOnce(firstCreate.promise).mockResolvedValue(created)
    getAllRecordsMock
      .mockResolvedValueOnce([createRecord({ queueId: 1 })])
      .mockResolvedValueOnce([
        createRecord({ queueId: 2, operation: { kind: 'create-entry', localEntryId: 2, payload } }),
      ])
      .mockResolvedValue([])
    const listener = jest.fn()
    const unsubscribe = subscribeToDrains(listener)

    const first = drainOutbox()
    await new Promise((r) => setTimeout(r, 0)) // let the first pass read the queue
    const joined = drainOutbox() // e.g. a save that queued entry 2 mid-pass
    firstCreate.resolve(created)

    const [summary, joinedSummary] = await Promise.all([first, joined])
    expect(summary).toEqual({ processed: 2, stoppedReason: 'empty' })
    expect(joinedSummary).toBe(summary)
    expect(removeRecordMock).toHaveBeenCalledWith(2)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('does not run another pass when the first one stopped on a failure', async () => {
    const firstCreate = deferred<ServerEntry>()
    createEntryMock.mockReturnValueOnce(firstCreate.promise)
    getAllRecordsMock.mockResolvedValue([createRecord()])

    const first = drainOutbox()
    await new Promise((r) => setTimeout(r, 0))
    void drainOutbox()
    firstCreate.reject(new Error('boom'))

    expect(await first).toEqual({ processed: 0, stoppedReason: 'error', error: 'boom' })
    expect(getAllRecordsMock).toHaveBeenCalledTimes(1)
  })
})

describe('subscribeToDrains', () => {
  it('tells each subscriber how every finished drain ended', async () => {
    reachableMock.mockResolvedValue(false)
    const listener = jest.fn()
    const unsubscribe = subscribeToDrains(listener)

    const summary = await drainOutbox()

    expect(listener).toHaveBeenCalledWith(summary)
    expect(summary).toEqual({ processed: 0, stoppedReason: 'unreachable' })
    unsubscribe()
  })

  it('stops notifying a subscriber once it unsubscribes', async () => {
    const listener = jest.fn()
    subscribeToDrains(listener)()

    await drainOutbox()

    expect(listener).not.toHaveBeenCalled()
  })

  it('never lets a throwing subscriber fail the drain or starve the others', async () => {
    const broken = jest.fn(() => {
      throw new Error('subscriber bug')
    })
    const healthy = jest.fn()
    const unsubscribeBroken = subscribeToDrains(broken)
    const unsubscribeHealthy = subscribeToDrains(healthy)

    await expect(drainOutbox()).resolves.toEqual({ processed: 0, stoppedReason: 'empty' })
    expect(healthy).toHaveBeenCalledTimes(1)
    unsubscribeBroken()
    unsubscribeHealthy()
  })
})

describe('drainOutbox with permanently rejected ops (#91)', () => {
  const tooLarge = new SyncHttpError(413, null, 'File too large')

  function uploadRecord(queueId: number, localEntryId: number, overrides: Partial<OutboxRecord> = {}): OutboxRecord {
    return createRecord({
      queueId,
      operation: { kind: 'upload-attachment', localEntryId, file: new Blob(), filename: 'big.jpg' },
      ...overrides,
    })
  }

  function createFor(queueId: number, localEntryId: number, overrides: Partial<OutboxRecord> = {}): OutboxRecord {
    return createRecord({ queueId, operation: { kind: 'create-entry', localEntryId, payload }, ...overrides })
  }

  beforeEach(() => {
    getSyncStateMock.mockImplementation((id: number) =>
      Promise.resolve(id === 1 ? { localEntryId: 1, serverId: 42, serverVersion: 1 } : undefined),
    )
    createEntryMock.mockResolvedValue({ id: 99, version: 1 })
  })

  it('parks a permanently rejected op and keeps draining the ops behind it', async () => {
    uploadAttachmentMock.mockRejectedValue(tooLarge)
    getAllRecordsMock.mockResolvedValue([uploadRecord(1, 1), createFor(2, 2)])

    const summary = await drainOutbox()

    expect(markRejectedMock).toHaveBeenCalledWith(1, 'File too large')
    expect(recordFailureMock).not.toHaveBeenCalled()
    expect(removeRecordMock).not.toHaveBeenCalledWith(1)
    expect(createEntryMock).toHaveBeenCalledTimes(1)
    expect(removeRecordMock).toHaveBeenCalledWith(2)
    expect(summary).toEqual({ processed: 1, stoppedReason: 'rejected', error: 'File too large' })
  })

  it('never retries an op that an earlier drain already parked', async () => {
    getAllRecordsMock.mockResolvedValue([
      uploadRecord(1, 1, { rejected: true, lastError: 'File too large' }),
      createFor(2, 2),
    ])

    const summary = await drainOutbox()

    expect(uploadAttachmentMock).not.toHaveBeenCalled()
    expect(markRejectedMock).not.toHaveBeenCalled()
    expect(summary).toEqual({ processed: 1, stoppedReason: 'rejected', error: 'File too large' })
  })

  it('parks every op that depends on a rejected create, with the reason, instead of running it', async () => {
    getAllRecordsMock.mockResolvedValue([
      createFor(1, 2, { rejected: true, lastError: 'Bad entry' }),
      createRecord({ queueId: 2, operation: { kind: 'update-entry', localEntryId: 2, payload: { version: 1 } } }),
      uploadRecord(3, 2),
      createFor(4, 3),
    ])

    const summary = await drainOutbox()

    expect(updateEntryMock).not.toHaveBeenCalled()
    expect(uploadAttachmentMock).not.toHaveBeenCalled()
    expect(recordFailureMock).not.toHaveBeenCalled()
    expect(markRejectedMock).toHaveBeenCalledTimes(2)
    expect(markRejectedMock).toHaveBeenCalledWith(2, 'Its entry was rejected by the server: Bad entry')
    expect(markRejectedMock).toHaveBeenCalledWith(3, 'Its entry was rejected by the server: Bad entry')
    expect(removeRecordMock).toHaveBeenCalledTimes(1)
    expect(removeRecordMock).toHaveBeenCalledWith(4)
    expect(summary).toEqual({ processed: 1, stoppedReason: 'rejected', error: 'Bad entry' })
  })

  it('parks the dependents of a create rejected during this same drain', async () => {
    createEntryMock.mockRejectedValueOnce(new SyncHttpError(400, null, 'Bad entry'))
    getAllRecordsMock.mockResolvedValue([createFor(1, 2), uploadRecord(2, 2)])

    const summary = await drainOutbox()

    expect(markRejectedMock).toHaveBeenCalledWith(1, 'Bad entry')
    expect(markRejectedMock).toHaveBeenCalledWith(2, 'Its entry was rejected by the server: Bad entry')
    expect(uploadAttachmentMock).not.toHaveBeenCalled()
    expect(summary).toEqual({ processed: 0, stoppedReason: 'rejected', error: 'Bad entry' })
  })

  it('still stops at a transient failure behind a parked op', async () => {
    createEntryMock.mockRejectedValue(new Error('Could not reach the server.'))
    getAllRecordsMock.mockResolvedValue([
      uploadRecord(1, 1, { rejected: true, lastError: 'File too large' }),
      createFor(2, 2),
      createFor(3, 3),
    ])

    const summary = await drainOutbox()

    expect(createEntryMock).toHaveBeenCalledTimes(1)
    expect(recordFailureMock).toHaveBeenCalledWith(2, 'Could not reach the server.')
    expect(summary).toEqual({ processed: 0, stoppedReason: 'error', error: 'Could not reach the server.' })
  })

  it('runs one more pass for work queued mid-drain even when the pass ended "rejected"', async () => {
    let releaseUpload: (() => void) | undefined
    uploadAttachmentMock.mockReturnValueOnce(
      new Promise((_, reject) => {
        releaseUpload = () => reject(tooLarge)
      }),
    )
    getAllRecordsMock
      .mockResolvedValueOnce([uploadRecord(1, 1)])
      .mockResolvedValue([uploadRecord(1, 1, { rejected: true, lastError: 'File too large' }), createFor(2, 2)])

    const first = drainOutbox()
    await new Promise((r) => setTimeout(r, 0)) // let the first pass reach the upload
    const joined = drainOutbox() // e.g. a save that queued entry 2 mid-pass
    releaseUpload?.()

    expect(await first).toEqual({ processed: 1, stoppedReason: 'rejected', error: 'File too large' })
    expect(await joined).toEqual(await first)
    expect(removeRecordMock).toHaveBeenCalledWith(2)
  })

  it('keeps draining when parking a dependent of a rejected create fails to persist', async () => {
    markRejectedMock.mockRejectedValue(new Error('db write failed'))
    getAllRecordsMock.mockResolvedValue([
      createFor(1, 2, { rejected: true, lastError: 'Bad entry' }),
      uploadRecord(2, 2),
      createFor(3, 3),
    ])

    const summary = await drainOutbox()

    expect(markRejectedMock).toHaveBeenCalledWith(2, 'Its entry was rejected by the server: Bad entry')
    expect(removeRecordMock).toHaveBeenCalledWith(3)
    expect(summary).toEqual({ processed: 1, stoppedReason: 'rejected', error: 'Bad entry' })
  })

  it('still reports the rejection when parking the op fails to persist', async () => {
    uploadAttachmentMock.mockRejectedValue(tooLarge)
    markRejectedMock.mockRejectedValue(new Error('db write failed'))
    getAllRecordsMock.mockResolvedValue([uploadRecord(1, 1)])

    const summary = await drainOutbox()

    expect(summary).toEqual({ processed: 0, stoppedReason: 'rejected', error: 'File too large' })
  })
})

describe('pauseDrains / resumeDrains (no sync under the wrong account, or with no login)', () => {
  afterEach(() => {
    resumeDrains()
    resumeDrains('account')
    resumeDrains('auth-mode')
  })

  it('stays paused until every reason that paused it has been released', async () => {
    await pauseDrains('account')
    await pauseDrains('auth-mode')

    resumeDrains('account')
    expect((await drainOutbox()).stoppedReason).toBe('aborted')

    resumeDrains('auth-mode')
    expect((await drainOutbox()).stoppedReason).toBe('empty')
  })

  it('treats pausing twice for one reason as one pause', async () => {
    await pauseDrains('account')
    await pauseDrains('account')
    resumeDrains('account')
    expect((await drainOutbox()).stoppedReason).toBe('empty')
  })

  it('ignores releasing a reason that was never held', async () => {
    await pauseDrains('account')
    resumeDrains('auth-mode')
    expect((await drainOutbox()).stoppedReason).toBe('aborted')
  })


  it('blocks a direct drain: nothing is read, probed or sent, and listeners hear nothing', async () => {
    const listener = jest.fn()
    const unsubscribe = subscribeToDrains(listener)
    await pauseDrains()

    const summary = await drainOutbox()

    expect(summary).toEqual({ processed: 0, stoppedReason: 'aborted' })
    expect(reachableMock).not.toHaveBeenCalled()
    expect(getAllRecordsMock).not.toHaveBeenCalled()
    expect(createEntryMock).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('blocks the reconnect trigger (the browser `online` event)', async () => {
    const stop = startAutoSync()
    try {
      await pauseDrains()
      window.dispatchEvent(new Event('online'))
      await Promise.resolve()
      expect(reachableMock).not.toHaveBeenCalled()
    } finally {
      stop()
    }
  })

  it('blocks every caller, so the mount, save and upload triggers (all drainOutbox) are blocked too', async () => {
    await pauseDrains()
    const results = await Promise.all([drainOutbox(), drainOutbox(), drainOutbox(new AbortController().signal)])
    expect(results.every((summary) => summary.stoppedReason === 'aborted')).toBe(true)
    expect(reachableMock).not.toHaveBeenCalled()
  })

  it('lets drains run again after resumeDrains', async () => {
    await pauseDrains()
    resumeDrains()

    const summary = await drainOutbox()

    expect(summary.stoppedReason).toBe('empty')
    expect(reachableMock).toHaveBeenCalled()
  })

  it('aborts a drain that is already in flight and waits for it to stop before resolving', async () => {
    let releaseUpload: (() => void) | undefined
    getAllRecordsMock.mockResolvedValue([createRecord({ queueId: 1 }), createRecord({ queueId: 2 })])
    createEntryMock.mockImplementation(
      () => new Promise((resolve) => (releaseUpload = () => resolve({ id: 42, version: 1 }))),
    )
    const running = drainOutbox()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(createEntryMock).toHaveBeenCalledTimes(1)

    const paused = pauseDrains()
    releaseUpload?.()
    await paused

    expect(await running).toEqual({ processed: 1, stoppedReason: 'aborted' })
    expect(createEntryMock).toHaveBeenCalledTimes(1)
  })

  it('still honours a caller\'s own abort signal', async () => {
    const controller = new AbortController()
    controller.abort()
    getAllRecordsMock.mockResolvedValue([createRecord({ queueId: 1 })])

    const summary = await drainOutbox(controller.signal)

    expect(summary).toEqual({ processed: 0, stoppedReason: 'aborted' })
    expect(createEntryMock).not.toHaveBeenCalled()
  })
})

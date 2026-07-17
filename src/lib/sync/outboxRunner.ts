import { isPersistenceSupported } from '../db/database.ts'
import { getAllRecords, recordAttemptFailure, removeRecord } from '../db/outboxStore.ts'
import { deleteSyncState, getSyncState, putSyncState } from '../db/syncStateStore.ts'
import { uploadAttachment } from './attachmentsApi.ts'
import { createEntry, deleteEntry, updateEntry } from './entriesApi.ts'
import { isBackendReachable } from './health.ts'
import type {
  CreateEntryOperation,
  DeleteEntryOperation,
  OutboxRecord,
  UpdateEntryOperation,
  UploadAttachmentOperation,
} from '../../types/outbox.ts'

/**
 * Drains #26's offline outbox against the real backend. Processes records
 * strictly FIFO and **stops at the first failure** rather than skipping or
 * reordering — an entry's create-entry op is always enqueued (by
 * outboxQueue.ts) before any update/delete/upload op that targets the same
 * localEntryId, so plain in-order draining is what guarantees "create
 * happens before anything that needs the resulting server id" without extra
 * bookkeeping. A failed op (including a #24 409 version conflict — this
 * runner deliberately does not attempt to auto-resolve those; per CLAUDE.md,
 * conflicts are never resolved by timestamp or guesswork, so a conflicted op
 * just stays queued with its error recorded until a future manual-resolution
 * UI lands) is left in place with `attempts`/`lastError` updated, and every
 * op behind it waits for the next drain rather than racing ahead
 * out of order.
 *
 * Sequential by design for the same reason the AI pipeline in
 * useNewEntryFlow.ts is sequential: predictable ordering beats throughput
 * for a single-user, low-volume write queue.
 */

export interface DrainSummary {
  processed: number
  stoppedReason: 'unsupported' | 'unreachable' | 'empty' | 'error' | 'aborted'
  error?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown sync error.'
}

async function processCreate(op: CreateEntryOperation, signal?: AbortSignal): Promise<void> {
  const existing = await getSyncState(op.localEntryId)
  if (existing?.serverId) return // Already created by an earlier drain that crashed before dequeuing.
  const created = await createEntry(op.payload, signal)
  await putSyncState({ localEntryId: op.localEntryId, serverId: created.id, serverVersion: created.version })
}

async function processUpdate(op: UpdateEntryOperation, signal?: AbortSignal): Promise<void> {
  const state = await getSyncState(op.localEntryId)
  if (!state?.serverId) {
    throw new Error(
      `Entry ${op.localEntryId} has not synced yet; its create-entry op should still be queued ahead of this update.`,
    )
  }
  const updated = await updateEntry(state.serverId, op.payload, signal)
  await putSyncState({ localEntryId: op.localEntryId, serverId: updated.id, serverVersion: updated.version })
}

async function processDelete(op: DeleteEntryOperation, signal?: AbortSignal): Promise<void> {
  const state = await getSyncState(op.localEntryId)
  if (!state?.serverId) return // Never synced — nothing server-side to delete.
  await deleteEntry(state.serverId, signal)
  await deleteSyncState(op.localEntryId)
}

async function processUpload(op: UploadAttachmentOperation, signal?: AbortSignal): Promise<void> {
  const state = await getSyncState(op.localEntryId)
  if (!state?.serverId) {
    throw new Error(
      `Entry ${op.localEntryId} has not synced yet; its create-entry op should still be queued ahead of this upload.`,
    )
  }
  await uploadAttachment(state.serverId, op.file, op.filename, signal)
}

async function processRecord(record: OutboxRecord, signal?: AbortSignal): Promise<void> {
  switch (record.operation.kind) {
    case 'create-entry':
      return processCreate(record.operation, signal)
    case 'update-entry':
      return processUpdate(record.operation, signal)
    case 'delete-entry':
      return processDelete(record.operation, signal)
    case 'upload-attachment':
      return processUpload(record.operation, signal)
  }
}

async function runDrain(signal?: AbortSignal): Promise<DrainSummary> {
  try {
    if (!isPersistenceSupported()) return { processed: 0, stoppedReason: 'unsupported' }
    if (!(await isBackendReachable(signal))) return { processed: 0, stoppedReason: 'unreachable' }

    const records = await getAllRecords()
    let processed = 0
    for (const record of records) {
      if (signal?.aborted) return { processed, stoppedReason: 'aborted' }
      try {
        await processRecord(record, signal)
        await removeRecord(record.queueId)
        processed += 1
      } catch (error) {
        const message = errorMessage(error)
        await recordAttemptFailure(record.queueId, message).catch(() => {})
        return { processed, stoppedReason: 'error', error: message }
      }
    }
    return { processed, stoppedReason: 'empty' }
  } catch (error) {
    return { processed: 0, stoppedReason: 'error', error: errorMessage(error) }
  }
}

// Concurrent callers (e.g. the mount-time drain and an 'online' event firing
// at nearly the same moment) share one in-flight pass instead of racing two
// drains against the same queue.
let inFlight: Promise<DrainSummary> | null = null

export function drainOutbox(signal?: AbortSignal): Promise<DrainSummary> {
  if (!inFlight) {
    inFlight = runDrain(signal).finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

/**
 * Registers the reconnect trigger for the outbox: a browser `online` event
 * kicks a drain. Guarded so environments without `window` (SSR/tests that
 * don't opt in) degrade to a no-op cleanup rather than throwing — the same
 * `typeof X === 'undefined'` pattern the AI/speech wrappers use for their
 * globals. This is the one place `window` is touched so hooks never do so
 * directly (see useSyncOutbox.ts).
 */
export function startAutoSync(): () => void {
  if (typeof window === 'undefined') return () => {}
  const handleOnline = () => {
    void drainOutbox()
  }
  window.addEventListener('online', handleOnline)
  return () => window.removeEventListener('online', handleOnline)
}

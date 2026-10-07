import { isPersistenceSupported } from '../db/database.ts'
import { getAllRecords, hasRecord, markRejected, recordAttemptFailure, removeRecord } from '../db/outboxStore.ts'
import { deleteSyncState, getSyncState, putSyncState } from '../db/syncStateStore.ts'
import { deleteAttachment, uploadAttachment } from './attachmentsApi.ts'
import { createEntry, deleteEntry, updateEntry } from './entriesApi.ts'
import { SyncAuthError, SyncHttpError, isPermanentRejection } from './errors.ts'
import { isBackendReachable } from './health.ts'
import type {
  CreateEntryOperation,
  DeleteAttachmentOperation,
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
 * The one exception is an op the server **permanently** rejected (a 4xx that
 * will fail identically forever — see `isPermanentRejection`, e.g. a 413
 * photo). Stopping there would pin the whole queue behind it (#91), so it is
 * parked (`rejected: true`) and the drain moves on. Ordering still holds:
 * ops for an entry whose create-entry is parked are parked too, since they
 * could never resolve a server id. Parked ops are never retried
 * automatically; the user discards them (see discardRejectedOperation).
 *
 * Sequential by design for the same reason the AI pipeline in
 * useNewEntryFlow.ts is sequential: predictable ordering beats throughput
 * for a single-user, low-volume write queue.
 */

export interface DrainSummary {
  processed: number
  /**
   * `'auth'` is its own reason (not folded into the generic `'error'`) so
   * callers can tell "the session cookie is missing/expired" apart from any
   * other failure and show a "sign in" message instead of the generic
   * "queued, will retry" one — see useEntryAttachments.ts and useAuth.ts.
   */
  /**
   * `'rejected'` means the pass reached the end of the queue but some ops are
   * parked as permanently rejected (or depend on a parked create), so the
   * queue is not empty; `error` then carries the first rejection's reason.
   */
  stoppedReason: 'unsupported' | 'unreachable' | 'empty' | 'error' | 'auth' | 'aborted' | 'rejected'
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

/**
 * Runs a server-side DELETE, treating a 404 as success: the thing is already
 * gone (an earlier drain crashed before dequeuing, or another device deleted
 * it), and a delete that can never succeed must not stall every op behind it.
 */
async function deleteIgnoringNotFound(request: () => Promise<void>): Promise<void> {
  try {
    await request()
  } catch (error) {
    if (!(error instanceof SyncHttpError && error.status === 404)) throw error
  }
}

async function processDelete(op: DeleteEntryOperation, signal?: AbortSignal): Promise<void> {
  const state = await getSyncState(op.localEntryId)
  if (!state?.serverId) return // Never synced — nothing server-side to delete.
  const serverId = state.serverId
  await deleteIgnoringNotFound(() => deleteEntry(serverId, signal))
  await deleteSyncState(op.localEntryId)
}

async function processDeleteAttachment(op: DeleteAttachmentOperation, signal?: AbortSignal): Promise<void> {
  await deleteIgnoringNotFound(() => deleteAttachment(op.serverAttachmentId, signal))
}

async function processUpload(op: UploadAttachmentOperation, queueId: number, signal?: AbortSignal): Promise<void> {
  const state = await getSyncState(op.localEntryId)
  if (!state?.serverId) {
    throw new Error(
      `Entry ${op.localEntryId} has not synced yet; its create-entry op should still be queued ahead of this upload.`,
    )
  }
  const uploaded = await uploadAttachment(state.serverId, op.file, op.filename, signal)
  // The user removed this photo while it was uploading (its queued op is
  // gone): undo the upload rather than leave a photo they asked to drop.
  if (!(await hasRecord(queueId))) await deleteIgnoringNotFound(() => deleteAttachment(uploaded.id, signal))
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
      return processUpload(record.operation, record.queueId, signal)
    case 'delete-attachment':
      return processDeleteAttachment(record.operation, signal)
  }
}

/** What one pass over the queue has learned so far. */
interface PassState {
  processed: number
  /** Entries whose create-entry op is parked (-> its reason): their
   *  dependents can't run. */
  blockedEntries: Map<number, string>
  firstRejection?: string
}

const REJECTED_FALLBACK = 'Rejected by the server.'

function isHeldBack(record: OutboxRecord, state: PassState): boolean {
  return record.rejected === true || state.blockedEntries.has(record.operation.localEntryId)
}

function noteRejection(record: OutboxRecord, message: string, state: PassState): void {
  state.firstRejection ??= message
  if (record.operation.kind === 'create-entry') state.blockedEntries.set(record.operation.localEntryId, message)
}

/**
 * Skips a parked op, or parks a dependent of a parked create too: it can
 * never run either, and parking it lets the UI show why (instead of a photo
 * stuck on "Uploading…") and offer to discard it.
 */
async function holdBack(record: OutboxRecord, state: PassState): Promise<void> {
  if (record.rejected) {
    noteRejection(record, record.lastError ?? REJECTED_FALLBACK, state)
    return
  }
  const reason = `Its entry was rejected by the server: ${state.blockedEntries.get(record.operation.localEntryId)}`
  await markRejected(record.queueId, reason).catch(() => {})
  noteRejection(record, reason, state)
}

/** Runs one record. Resolves a summary only when the pass must stop here. */
async function attemptRecord(
  record: OutboxRecord,
  state: PassState,
  signal?: AbortSignal,
): Promise<DrainSummary | null> {
  try {
    await processRecord(record, signal)
    await removeRecord(record.queueId)
    state.processed += 1
    return null
  } catch (error) {
    const message = errorMessage(error)
    if (isPermanentRejection(error)) {
      await markRejected(record.queueId, message).catch(() => {})
      noteRejection(record, message, state)
      return null
    }
    await recordAttemptFailure(record.queueId, message).catch(() => {})
    // Only a 401 means the session is gone. A 403 is a refusal (e.g. a stale
    // CSRF cookie), shown as a generic sync error rather than "sign in".
    const stoppedReason = error instanceof SyncAuthError && error.status === 401 ? 'auth' : 'error'
    return { processed: state.processed, stoppedReason, error: message }
  }
}

async function processQueue(records: OutboxRecord[], signal?: AbortSignal): Promise<DrainSummary> {
  const state: PassState = { processed: 0, blockedEntries: new Map() }
  for (const record of records) {
    if (signal?.aborted || !drainsAllowed) return { processed: state.processed, stoppedReason: 'aborted' }
    // The pass works from one snapshot; the user may have removed this op
    // since (deleted its entry or photo), so never run one that's gone.
    if (!(await hasRecord(record.queueId))) continue
    if (isHeldBack(record, state)) {
      await holdBack(record, state)
      continue
    }
    const stop = await attemptRecord(record, state, signal)
    if (stop) return stop
  }
  if (state.firstRejection === undefined) return { processed: state.processed, stoppedReason: 'empty' }
  return { processed: state.processed, stoppedReason: 'rejected', error: state.firstRejection }
}

async function runDrain(signal?: AbortSignal): Promise<DrainSummary> {
  try {
    if (!isPersistenceSupported()) return { processed: 0, stoppedReason: 'unsupported' }
    if (!(await isBackendReachable(signal))) return { processed: 0, stoppedReason: 'unreachable' }
    return await processQueue(await getAllRecords(), signal)
  } catch (error) {
    return { processed: 0, stoppedReason: 'error', error: errorMessage(error) }
  }
}

// Drains start from several places (mount, save, photo upload, sign-in, the
// `online` event), so whoever shows sync state subscribes here rather than
// tracking only the drains it happened to start itself.
const drainListeners = new Set<(summary: DrainSummary) => void>()

/** Calls `listener` with the summary of every drain that finishes; returns the unsubscribe. */
export function subscribeToDrains(listener: (summary: DrainSummary) => void): () => void {
  drainListeners.add(listener)
  return () => {
    drainListeners.delete(listener)
  }
}

function notifyDrainListeners(summary: DrainSummary): DrainSummary {
  for (const listener of drainListeners) {
    try {
      listener(summary)
    } catch {
      // A broken subscriber must never fail the drain or starve the others.
    }
  }
  return summary
}

// Concurrent callers (e.g. the mount-time drain and an 'online' event firing
// at nearly the same moment) share one in-flight drain instead of racing two
// against the same queue. A pass reads the queue once, so a caller that joins
// mid-pass (typically a save that just queued its entry) asks for one more
// pass; otherwise the drain would end 'empty' — "synced" — with that op still
// waiting.
let inFlight: Promise<DrainSummary> | null = null
let rerunRequested = false

async function drainUntilSettled(signal?: AbortSignal): Promise<DrainSummary> {
  let processed = 0
  let summary: DrainSummary
  do {
    rerunRequested = false
    summary = await runDrain(signal)
    processed += summary.processed
  } while (rerunRequested && (summary.stoppedReason === 'empty' || summary.stoppedReason === 'rejected'))
  return { ...summary, processed }
}

export function drainOutbox(signal?: AbortSignal): Promise<DrainSummary> {
  if (!drainsAllowed) return Promise.resolve({ processed: 0, stoppedReason: 'aborted' })
  if (inFlight) {
    rerunRequested = true
    return inFlight
  }
  inFlight = drainUntilSettled(signal)
    .then(notifyDrainListeners)
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

// While drains are not allowed every trigger (mount, save, upload, `online`) is a
// no-op, as they all go through drainOutbox. useAuth owns the flag: nothing
// uploads under a session not yet matched to this device's identity, and a
// login-less app never churns on 401s.
let drainsAllowed = true

/** Allows or blocks all drains; one already running stops at its next operation. A blocked drain reports `'aborted'`. */
export function setDrainsAllowed(allowed: boolean): void {
  drainsAllowed = allowed
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

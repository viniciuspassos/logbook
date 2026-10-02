import { isPersistenceSupported } from '../db/database.ts'
import { enqueueOperation, getAllRecords, removeRecord } from '../db/outboxStore.ts'
import { getSyncState } from '../db/syncStateStore.ts'
import { listAttachmentsForEntry } from './attachmentsApi.ts'
import type { Entry } from '../../types/entry.ts'
import type { CreateEntryPayload, ServerAttachment, UpdateEntryPayload } from '../../types/sync.ts'
import type { OutboxRecord } from '../../types/outbox.ts'

/**
 * Business rules for adding work to #26's offline outbox — the layer
 * `useSyncOutbox.ts`/`useEntryAttachments.ts` call instead of touching
 * `src/lib/db/outboxStore.ts`/`syncStateStore.ts` directly. `outboxRunner.ts`
 * is the other half: it drains what this module enqueues.
 *
 * Every function here is additive and never throws — a durable-queue write
 * failing (unsupported/full storage) must never block the entry creation
 * that already happened via `useEntries`/`entriesStore`, same rule as the
 * rest of this app's browser-API wrappers.
 */

/** Entry -> POST /entries body: every field except the local-only `id`. */
export function entryToCreatePayload(entry: Entry): CreateEntryPayload {
  const { id, ...payload } = entry
  void id // discarded deliberately: the server mints its own id on create
  return payload
}

export async function queueEntryCreate(entry: Entry): Promise<void> {
  if (!isPersistenceSupported()) return
  try {
    await enqueueOperation({
      kind: 'create-entry',
      localEntryId: entry.id,
      payload: entryToCreatePayload(entry),
    })
  } catch {
    // Queuing is best-effort; the entry is already saved locally.
  }
}

/**
 * Queues a PATCH for an entry that already synced. Built for completeness —
 * #26 ships no edit-entry UI yet, so nothing calls this today; it exists so
 * the outbox's operation set matches the server API contract in full and
 * `outboxRunner.ts` has something real to drain once an edit flow lands.
 *
 * Unlike queueAttachmentUpload, this does NOT self-heal a missing create-entry
 * op ahead of it — a future edit-entry hook must either guarantee the entry
 * it edits has already synced (or has a create queued), or adopt the same
 * `hasPendingCreate`/self-heal check queueAttachmentUpload uses below, before
 * this is wired to real UI. Without that, editing a legacy/seed entry that
 * predates the outbox would queue an update with nothing ahead of it to give
 * it a serverId, and outboxRunner.ts would stop every future drain on it.
 */
export async function queueEntryUpdate(
  entry: Entry,
  fields: Pick<UpdateEntryPayload, 'version' | 'supersededEdit'>,
): Promise<void> {
  if (!isPersistenceSupported()) return
  try {
    await enqueueOperation({
      kind: 'update-entry',
      localEntryId: entry.id,
      payload: { ...entryToCreatePayload(entry), ...fields },
    })
  } catch {
    // Best-effort, same as queueEntryCreate.
  }
}

/**
 * Queues a raw DELETE for an entry. Prefer {@link queueEntryDeletion}, which
 * the delete-entry UI uses: it also drops the entry's still-queued ops first.
 * No self-heal gap here: outboxRunner.ts's processDelete treats "no serverId
 * yet" as "nothing to delete server-side" and no-ops rather than throwing, so
 * a delete queued for a never-synced entry can't get the drain stuck the way
 * an update would.
 */
export async function queueEntryDelete(localEntryId: number): Promise<void> {
  if (!isPersistenceSupported()) return
  try {
    await enqueueOperation({ kind: 'delete-entry', localEntryId })
  } catch {
    // Best-effort, same as queueEntryCreate.
  }
}

/**
 * Everything the outbox needs when the user deletes an entry: every op still
 * queued for it (its create, edits, photo uploads, photo deletes) is dropped
 * — there's no point uploading a photo for an entry that's about to go — and
 * a DELETE is queued only if the server actually has the entry. A
 * never-synced entry therefore leaves no trace in the queue at all. Never
 * throws, same as queueEntryCreate: the local delete already happened.
 */
export async function queueEntryDeletion(localEntryId: number): Promise<void> {
  if (!isPersistenceSupported()) return
  try {
    const records = await getAllRecords()
    for (const record of records) {
      if (record.operation.localEntryId === localEntryId) await removeRecord(record.queueId)
    }
    const syncState = await getSyncState(localEntryId)
    if (syncState?.serverId) await queueEntryDelete(localEntryId)
  } catch {
    // Best-effort, same as queueEntryCreate.
  }
}

/**
 * Queues the removal of an already-uploaded photo. Unlike the entry-level
 * queue functions this lets storage failures propagate: the user explicitly
 * asked for this photo to go, so useEntryAttachments.ts must be able to say
 * it didn't. The photo
 * disappears from the gallery straight away: getEntryAttachmentSources hides
 * any server attachment with one of these ops queued.
 */
export async function queueAttachmentDelete(localEntryId: number, serverAttachmentId: number): Promise<void> {
  if (!isPersistenceSupported()) return
  await enqueueOperation({ kind: 'delete-attachment', localEntryId, serverAttachmentId })
}

/** True if the outbox already has an un-drained create-entry op for this entry. */
async function hasPendingCreate(localEntryId: number): Promise<boolean> {
  const records = await getAllRecords()
  return records.some(
    (record) => record.operation.kind === 'create-entry' && record.operation.localEntryId === localEntryId,
  )
}

/**
 * Queues a create for every entry in `entries` — used when a backup restore
 * replaces the whole list, so the restored entries reach the backend like any
 * freshly saved one. Re-queuing is harmless: outboxRunner's processCreate
 * no-ops once a serverId is mapped, so duplicates (a second restore before a
 * drain, or entries that already synced) never create twice. Never throws,
 * same as queueEntryCreate.
 */
export async function queueEntryCreates(entries: Entry[]): Promise<void> {
  for (const entry of entries) await queueEntryCreate(entry)
}

/**
 * Queues a photo upload for `entry`. An attachment upload needs a *real*
 * server entry id, which only exists once the entry's create-entry op has
 * drained — so this ensures one is either already synced, already queued
 * ahead of this upload, or (self-healing case: a legacy/seed entry that
 * predates the outbox and was never queued at all) queues one now. Either
 * way the create op is guaranteed to sit ahead of this upload op in FIFO
 * order, which is what makes outboxRunner.ts's plain "process in order, stop
 * on failure" draining safe without any other coordination.
 */
export async function queueAttachmentUpload(entry: Entry, file: Blob, filename: string): Promise<void> {
  if (!isPersistenceSupported()) return
  try {
    const syncState = await getSyncState(entry.id)
    if (!syncState?.serverId && !(await hasPendingCreate(entry.id))) {
      await queueEntryCreate(entry)
    }
    await enqueueOperation({ kind: 'upload-attachment', localEntryId: entry.id, file, filename })
  } catch {
    // Best-effort, same as queueEntryCreate.
  }
}

/** Every queued op, or `[]` when storage is unavailable/unreadable. */
async function readQueue(): Promise<OutboxRecord[]> {
  if (!isPersistenceSupported()) return []
  try {
    return await getAllRecords()
  } catch {
    return []
  }
}

/**
 * Drops one queued op: a photo the server permanently rejected (#91) — the
 * user's way out of a photo that will never upload — or one the user removes
 * before it ever uploaded (useEntryAttachments.removePhoto). Resolves `false`
 * rather than throwing when the queue write fails, so the caller can say so.
 */
export async function discardRejectedOperation(queueId: number): Promise<boolean> {
  try {
    await removeRecord(queueId)
    return true
  } catch {
    return false
  }
}

function pendingUploadsFor(records: OutboxRecord[], localEntryId: number): OutboxRecord[] {
  return records.filter(
    (record) => record.operation.kind === 'upload-attachment' && record.operation.localEntryId === localEntryId,
  )
}

/** Queued (not-yet-uploaded) attachment ops for one entry, for local preview. */
export async function listPendingAttachments(localEntryId: number): Promise<OutboxRecord[]> {
  return pendingUploadsFor(await readQueue(), localEntryId)
}

/** Server attachment ids with a delete-attachment op still queued. */
function queuedAttachmentDeletes(records: OutboxRecord[]): Set<number> {
  const ids = new Set<number>()
  for (const { operation } of records) {
    if (operation.kind === 'delete-attachment') ids.add(operation.serverAttachmentId)
  }
  return ids
}

export interface EntryAttachmentSources {
  serverAttachments: ServerAttachment[]
  pending: OutboxRecord[]
}

/**
 * Everything useEntryAttachments.ts needs to render an entry's attachment
 * gallery: attachments already confirmed by the server (if this entry has
 * synced) — minus any whose delete is still queued — plus anything still
 * queued locally. Never throws — an unreachable
 * server just means an empty `serverAttachments` list, same degrade-gracefully
 * rule as everywhere else this app talks to the backend.
 */
export async function getEntryAttachmentSources(
  entry: Entry,
  signal?: AbortSignal,
): Promise<EntryAttachmentSources> {
  const records = await readQueue()
  const pending = pendingUploadsFor(records, entry.id)
  const syncState = await getSyncState(entry.id).catch(() => undefined)
  if (!syncState?.serverId) {
    return { serverAttachments: [], pending }
  }
  try {
    const deleting = queuedAttachmentDeletes(records)
    const serverAttachments = (await listAttachmentsForEntry(syncState.serverId, signal)).filter(
      (attachment) => !deleting.has(attachment.id),
    )
    return { serverAttachments, pending }
  } catch {
    return { serverAttachments: [], pending }
  }
}

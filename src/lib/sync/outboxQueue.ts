import { isPersistenceSupported } from '../db/database.ts'
import { enqueueOperation, getAllRecords } from '../db/outboxStore.ts'
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
 * Queues a DELETE for an entry. Also built for completeness — see
 * queueEntryUpdate's docstring; #26 ships no delete-entry UI. Unlike update,
 * this one has no self-heal gap: outboxRunner.ts's processDelete treats "no
 * serverId yet" as "nothing to delete server-side" and no-ops rather than
 * throwing, so a delete queued for a never-synced entry can't get the drain
 * stuck the way an update would.
 */
export async function queueEntryDelete(localEntryId: number): Promise<void> {
  if (!isPersistenceSupported()) return
  try {
    await enqueueOperation({ kind: 'delete-entry', localEntryId })
  } catch {
    // Best-effort, same as queueEntryCreate.
  }
}

/** True if the outbox already has an un-drained create-entry op for this entry. */
async function hasPendingCreate(localEntryId: number): Promise<boolean> {
  const records = await getAllRecords()
  return records.some(
    (record) => record.operation.kind === 'create-entry' && record.operation.localEntryId === localEntryId,
  )
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

/** Queued (not-yet-uploaded) attachment ops for one entry, for local preview. */
export async function listPendingAttachments(localEntryId: number): Promise<OutboxRecord[]> {
  if (!isPersistenceSupported()) return []
  try {
    const records = await getAllRecords()
    return records.filter(
      (record) => record.operation.kind === 'upload-attachment' && record.operation.localEntryId === localEntryId,
    )
  } catch {
    return []
  }
}

export interface EntryAttachmentSources {
  serverAttachments: ServerAttachment[]
  pending: OutboxRecord[]
}

/**
 * Everything useEntryAttachments.ts needs to render an entry's attachment
 * gallery: attachments already confirmed by the server (if this entry has
 * synced) plus anything still queued locally. Never throws — an unreachable
 * server just means an empty `serverAttachments` list, same degrade-gracefully
 * rule as everywhere else this app talks to the backend.
 */
export async function getEntryAttachmentSources(
  entry: Entry,
  signal?: AbortSignal,
): Promise<EntryAttachmentSources> {
  const pending = await listPendingAttachments(entry.id)
  const syncState = await getSyncState(entry.id).catch(() => undefined)
  if (!syncState?.serverId) {
    return { serverAttachments: [], pending }
  }
  try {
    const serverAttachments = await listAttachmentsForEntry(syncState.serverId, signal)
    return { serverAttachments, pending }
  } catch {
    return { serverAttachments: [], pending }
  }
}

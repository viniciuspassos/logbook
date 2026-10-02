import type { CreateEntryPayload, UpdateEntryPayload } from './sync.ts'

/**
 * Local-only shapes for #26's offline write queue (the "outbox") and its
 * local-id -> server-id reconciliation map. Unlike `sync.ts`'s DTOs, none of
 * this crosses the wire — it's how `src/lib/db/outboxStore.ts` and
 * `src/lib/db/syncStateStore.ts` structure what they persist, and what
 * `src/lib/sync/outboxRunner.ts` drains.
 *
 * Every operation is keyed by `localEntryId` — the id `useEntries`/
 * `entriesStore` already mint for a brand-new entry (see useLogbookApp's
 * `saveEntry`), *not* the server's id, which doesn't exist yet at enqueue
 * time. `outboxRunner.ts` resolves `localEntryId -> serverId` via
 * `EntrySyncState` at drain time.
 */

export interface CreateEntryOperation {
  kind: 'create-entry'
  localEntryId: number
  payload: CreateEntryPayload
}

export interface UpdateEntryOperation {
  kind: 'update-entry'
  localEntryId: number
  payload: UpdateEntryPayload
}

export interface DeleteEntryOperation {
  kind: 'delete-entry'
  localEntryId: number
}

/** `file`/`filename` mirror attachmentsApi.uploadAttachment's own params —
 *  the Blob itself lives in the outbox until it's actually uploaded, since
 *  there's nowhere else in this app that durably holds an unsent photo. */
export interface UploadAttachmentOperation {
  kind: 'upload-attachment'
  localEntryId: number
  file: Blob
  filename: string
}

/** Removes one already-uploaded photo. `serverAttachmentId` is the server's
 *  own attachment id (only a server-confirmed photo needs this op — a photo
 *  still queued for upload is removed by dropping its upload op instead). */
export interface DeleteAttachmentOperation {
  kind: 'delete-attachment'
  localEntryId: number
  serverAttachmentId: number
}

export type OutboxOperation =
  | CreateEntryOperation
  | UpdateEntryOperation
  | DeleteEntryOperation
  | UploadAttachmentOperation
  | DeleteAttachmentOperation

/** A queued operation as stored — `queueId` is assigned by IndexedDB
 *  (autoincrement), so it's absent on a not-yet-enqueued operation. */
export interface OutboxRecord {
  queueId: number
  createdAt: string
  attempts: number
  lastError?: string
  /** The server permanently rejected this op (#91): the runner skips it, and
   *  everything that depends on it, instead of retrying it forever.
   *  `lastError` holds the server's reason. */
  rejected?: boolean
  operation: OutboxOperation
}

export type NewOutboxRecord = Omit<OutboxRecord, 'queueId' | 'attempts' | 'createdAt'>

/** The local-id -> server-id (+ last known version) mapping for one entry.
 *  Absent entirely means "never synced" (e.g. a legacy/seed entry, or one
 *  whose create op hasn't drained yet). */
export interface EntrySyncState {
  localEntryId: number
  serverId?: number
  serverVersion?: number
}

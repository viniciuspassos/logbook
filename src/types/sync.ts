import type { Entry } from './entry.ts'

/**
 * Shapes for talking to the backend added by #26. Not ambient (unlike the
 * `*.d.ts` files in this directory) — these are ordinary exported types for
 * our own DTOs, not declarations of a missing browser global.
 *
 * `Entry` already mirrors server/src/entries/entry.entity.ts field-for-field
 * (minus server-only bookkeeping), so payload shapes are derived from it
 * rather than redeclared — one place stops drifting from the other.
 */

/** POST /entries body: every Entry field except `id` (the server mints it). */
export type CreateEntryPayload = Omit<Entry, 'id'>

/**
 * PATCH /entries/:id body: any subset of the create fields, plus the
 * optimistic-concurrency fields from #24 — see UpdateEntryDto on the server.
 */
export interface UpdateEntryPayload extends Partial<CreateEntryPayload> {
  /** The version this edit was based on; a mismatch means someone else moved
   *  on since — see EntryVersionConflictException / SyncConflictError. */
  version: number
  /** A losing draft to preserve rather than discard, from a caller resolving
   *  an earlier 409. */
  supersededEdit?: Partial<CreateEntryPayload>
}

/** GET/POST /entries response shape — Entry plus the server's version counter. */
export interface ServerEntry extends Entry {
  version: number
}

/** Attachment metadata, as returned by every attachments endpoint. */
export interface ServerAttachment {
  id: number
  entryId: number
  originalFilename: string
  storageKey: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}

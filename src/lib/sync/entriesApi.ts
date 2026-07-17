import { syncRequest } from './httpClient.ts'
import type { CreateEntryPayload, ServerEntry, UpdateEntryPayload } from '../../types/sync.ts'

/** GET /entries — excludes soft-deleted rows. */
export function listEntries(signal?: AbortSignal): Promise<ServerEntry[]> {
  return syncRequest<ServerEntry[]>('/entries', { signal })
}

/** GET /entries/:id */
export function getEntry(id: number, signal?: AbortSignal): Promise<ServerEntry> {
  return syncRequest<ServerEntry>(`/entries/${id}`, { signal })
}

/** POST /entries — the server mints `id` and starts `version` at 1. */
export function createEntry(
  payload: CreateEntryPayload,
  signal?: AbortSignal,
): Promise<ServerEntry> {
  return syncRequest<ServerEntry>('/entries', { method: 'POST', body: payload, signal })
}

/**
 * PATCH /entries/:id. Rejects with SyncConflictError (see errors.ts) on a
 * version mismatch — the caller (outboxRunner.ts) decides how to resolve it
 * rather than this wrapper guessing, per #24: never resolve conflicts by
 * timestamp.
 */
export function updateEntry(
  id: number,
  payload: UpdateEntryPayload,
  signal?: AbortSignal,
): Promise<ServerEntry> {
  return syncRequest<ServerEntry>(`/entries/${id}`, { method: 'PATCH', body: payload, signal })
}

/**
 * DELETE /entries/:id — a soft delete (tombstone) server-side. There is no
 * "deletions since X" delta endpoint, so a device that created a local copy
 * offline before this ran will never learn about the delete on its own —
 * cross-device delete propagation is out of scope (see #26's issue body).
 */
export function deleteEntry(id: number, signal?: AbortSignal): Promise<void> {
  return syncRequest<void>(`/entries/${id}`, { method: 'DELETE', signal })
}

import { getApiBaseUrl } from './config.ts'
import { syncRequest, syncRequestBlob } from './httpClient.ts'
import type { ServerAttachment } from '../../types/sync.ts'

/**
 * POST /entries/:entryId/attachments — multipart upload, field name must be
 * `file` (server: EntryAttachmentsController.upload). `entryId` must be a
 * real server id; the caller (the attachments hook / outbox runner) is
 * responsible for having resolved the local entry to its server id first —
 * see outboxRunner.ts's docstring on the local-id -> server-id ordering
 * constraint.
 */
export function uploadAttachment(
  entryId: number,
  file: Blob,
  filename: string,
  signal?: AbortSignal,
): Promise<ServerAttachment> {
  const form = new FormData()
  form.append('file', file, filename)
  return syncRequest<ServerAttachment>(`/entries/${entryId}/attachments`, {
    method: 'POST',
    body: form,
    signal,
  })
}

/** GET /entries/:entryId/attachments */
export function listAttachmentsForEntry(
  entryId: number,
  signal?: AbortSignal,
): Promise<ServerAttachment[]> {
  return syncRequest<ServerAttachment[]>(`/entries/${entryId}/attachments`, { signal })
}

/** GET /attachments/:id */
export function getAttachmentMetadata(id: number, signal?: AbortSignal): Promise<ServerAttachment> {
  return syncRequest<ServerAttachment>(`/attachments/${id}`, { signal })
}

/** GET /attachments/:id/file — raw bytes, for previewing an already-uploaded photo. */
export function getAttachmentFile(id: number, signal?: AbortSignal): Promise<Blob> {
  return syncRequestBlob(`/attachments/${id}/file`, { signal })
}

/**
 * GET /attachments/:id/file as a plain URL, for use directly as an `<img
 * src>` rather than a fetched Blob/object URL. A same-origin `<img>` request
 * carries the session cookie automatically (unlike `fetch`, there's no
 * `credentials` mode to opt into), so this is both simpler and avoids the
 * object-URL lifecycle (create/revoke) a Blob-based preview would need — see
 * useEntryAttachments.ts, which uses this for every already-uploaded photo
 * and only manages an object URL for a locally-queued, not-yet-uploaded one.
 */
export function attachmentFileUrl(id: number): string {
  return `${getApiBaseUrl()}/attachments/${id}/file`
}

/** DELETE /attachments/:id */
export function deleteAttachment(id: number, signal?: AbortSignal): Promise<void> {
  return syncRequest<void>(`/attachments/${id}`, { method: 'DELETE', signal })
}

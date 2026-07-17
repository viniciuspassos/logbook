/**
 * Client-side pre-checks for a photo the user is about to queue for upload.
 * Mirrors the server's own rules (server/src/attachments/image-type.ts and
 * config/configuration.ts's `maxUploadSizeBytes`, defaulting to 25MB) so a
 * bad file is rejected instantly instead of round-tripping to the backend
 * first — but this is a courtesy, not the source of truth: the server always
 * re-validates by magic bytes (never trusting a client-declared MIME type),
 * so a mismatch here (e.g. a stale copy of this constant) just means an
 * occasional 400/413 the outbox runner already handles gracefully.
 */

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/** Declared (not sniffed) MIME types this pre-check accepts. Best-effort
 *  only — `File.type` is whatever the browser/OS guesses from the extension. */
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const

export type AttachmentValidationResult = { ok: true } | { ok: false; reason: string }

export function validateAttachmentFile(file: File): AttachmentValidationResult {
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(file.type as (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number])) {
    return { ok: false, reason: "That file isn't a supported image type (JPEG, PNG, WebP, or HEIC)." }
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: 'That photo is too large (max 25MB).' }
  }
  return { ok: true }
}

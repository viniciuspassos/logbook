import { useId, type ChangeEvent } from 'react'
import { cx } from '../lib/cx.ts'
import type { AttachmentPreview, AttachmentStatus } from '../hooks/useEntryAttachments.ts'
import './AttachmentGallery.css'

interface AttachmentGalleryProps {
  attachments: AttachmentPreview[]
  busy: boolean
  status: AttachmentStatus | null
  onAddPhoto: (file: File) => void
}

/**
 * Real, uploaded photo attachments (#26) — distinct from `entry.media`'s
 * decorative AI/seed hint strings (see PhotoPlaceholder, still used
 * elsewhere in EntryDetailOverlay for those). Presentational: all loading/
 * upload/validation state lives in useEntryAttachments.ts.
 */
export function AttachmentGallery({ attachments, busy, status, onAddPhoto }: AttachmentGalleryProps) {
  const inputId = useId()

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // allow re-selecting the same file next time
    if (file) onAddPhoto(file)
  }

  return (
    <div className="attachment-gallery">
      {attachments.length > 0 && (
        <div className="attachment-gallery__grid">
          {attachments.map((attachment) => (
            <div key={attachment.key} className="attachment-gallery__item">
              {attachment.url && (
                <img
                  className="attachment-gallery__image"
                  src={attachment.url}
                  alt={attachment.pending ? 'Photo attachment, uploading' : 'Photo attachment'}
                />
              )}
              {attachment.pending && (
                <span className="attachment-gallery__pending-badge">Uploading…</span>
              )}
            </div>
          ))}
        </div>
      )}

      <label
        htmlFor={inputId}
        className={cx('attachment-gallery__add', busy && 'attachment-gallery__add--busy')}
      >
        {busy ? 'Adding photo…' : '+ Add photo'}
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        capture="environment"
        aria-label="Add photo"
        disabled={busy}
        onChange={handleChange}
        className="attachment-gallery__input"
      />

      {/* Announces upload/queue outcomes, matching EntryDetailOverlay's own
       *  export-status region (entry-detail__status). */}
      <div
        className="attachment-gallery__status"
        role="status"
        aria-live="polite"
        aria-label="Attachment status"
      >
        {status && (
          <span
            className={cx(
              'attachment-gallery__status-text',
              status.tone === 'error' && 'attachment-gallery__status-text--error',
            )}
          >
            {status.message}
          </span>
        )}
      </div>
    </div>
  )
}

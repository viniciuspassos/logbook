import { useId, type ChangeEvent } from 'react'
import { cx } from '../lib/cx.ts'
import { ConfirmButton } from './ConfirmButton.tsx'
import type { AttachmentPreview, AttachmentStatus } from '../hooks/useEntryAttachments.ts'
import './AttachmentGallery.css'

interface AttachmentGalleryProps {
  attachments: AttachmentPreview[]
  busy: boolean
  status: AttachmentStatus | null
  onAddPhoto: (file: File) => void
  /** Discards a photo the server permanently rejected, by its outbox queueId. */
  onDiscardPhoto?: (queueId: number) => void
  /** Removes just this photo (the entry stays); no remove buttons without it. */
  onRemovePhoto?: (attachment: AttachmentPreview) => void
}

function altText(attachment: AttachmentPreview): string {
  if (attachment.rejectedReason !== undefined) return 'Photo attachment, rejected by the server'
  return attachment.pending ? 'Photo attachment, uploading' : 'Photo attachment'
}

interface AttachmentTileProps {
  attachment: AttachmentPreview
  /** 1-based position, so each remove button has its own accessible name. */
  position: number
  busy: boolean
  onDiscard?: (queueId: number) => void
  onRemove?: (attachment: AttachmentPreview) => void
}

function AttachmentTile({ attachment, position, busy, onDiscard, onRemove }: AttachmentTileProps) {
  const { rejectedReason, queueId } = attachment
  return (
    <div className="attachment-gallery__item">
      {attachment.url && <img className="attachment-gallery__image" src={attachment.url} alt={altText(attachment)} />}
      {attachment.pending && <span className="attachment-gallery__pending-badge">Uploading…</span>}
      {rejectedReason !== undefined && (
        <div className="attachment-gallery__rejected">
          <span className="attachment-gallery__rejected-reason">Rejected: {rejectedReason}</span>
          {queueId !== undefined && onDiscard && (
            <button
              type="button"
              className="attachment-gallery__remove"
              aria-label="Remove rejected photo"
              onClick={() => onDiscard(queueId)}
            >
              Remove
            </button>
          )}
        </div>
      )}
      {/* A rejected photo already offers its own Remove above. */}
      {rejectedReason === undefined && onRemove && (
        <ConfirmButton
          label={`Remove photo ${position}`}
          confirmLabel="Remove"
          cancelLabel="Keep"
          disabled={busy}
          className="attachment-gallery__delete"
          onConfirm={() => onRemove(attachment)}
        >
          <span aria-hidden="true">×</span>
        </ConfirmButton>
      )}
    </div>
  )
}

/**
 * Real, uploaded photo attachments (#26) — distinct from `entry.media`'s
 * decorative AI/seed hint strings (see PhotoPlaceholder, still used
 * elsewhere in EntryDetailOverlay for those). Presentational: all loading/
 * upload/removal/validation state lives in useEntryAttachments.ts.
 */
export function AttachmentGallery({
  attachments,
  busy,
  status,
  onAddPhoto,
  onDiscardPhoto,
  onRemovePhoto,
}: AttachmentGalleryProps) {
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
          {attachments.map((attachment, index) => (
            <AttachmentTile
              key={attachment.key}
              attachment={attachment}
              position={index + 1}
              busy={busy}
              onDiscard={onDiscardPhoto}
              onRemove={onRemovePhoto}
            />
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

import { AttachmentGallery } from '../components/AttachmentGallery.tsx'
import { OverlayHeader } from '../components/OverlayHeader.tsx'
import { PhotoPlaceholder } from '../components/PhotoPlaceholder.tsx'
import { ShapeGlyph } from '../components/ShapeGlyph.tsx'
import type { AttachmentPreview, AttachmentStatus } from '../hooks/useEntryAttachments.ts'
import type { ExportStatus } from '../hooks/useExportActions.ts'
import { cx } from '../lib/cx.ts'
import type { Entry } from '../types/entry.ts'
import './EntryDetailOverlay.css'

interface EntryDetailOverlayProps {
  entry: Entry
  rawOpen: boolean
  /** Disables the export buttons while another export is already in flight. */
  exportBusy?: boolean
  /** Outcome of the last export triggered from this overlay, if any. */
  exportStatus?: ExportStatus | null
  /** Real, uploaded photo attachments (#26) for this entry — separate from
   *  `entry.media`'s decorative hint strings rendered just above. */
  attachments?: AttachmentPreview[]
  attachmentsBusy?: boolean
  attachmentsStatus?: AttachmentStatus | null
  onToggleRaw: () => void
  onClose: () => void
  onExportMarkdown: (entry: Entry) => void
  onExportPdf: (entry: Entry) => void
  onAddPhoto?: (file: File) => void
}

export function EntryDetailOverlay({
  entry,
  rawOpen,
  exportBusy = false,
  exportStatus = null,
  attachments = [],
  attachmentsBusy = false,
  attachmentsStatus = null,
  onToggleRaw,
  onClose,
  onExportMarkdown,
  onExportPdf,
  onAddPhoto = () => {},
}: EntryDetailOverlayProps) {
  return (
    <div className="entry-detail">
      <OverlayHeader label="Back" onBack={onClose} />

      <div className="entry-detail__body">
        <div className="entry-detail__intro">
          <div className="entry-detail__icon">
            <ShapeGlyph shape={entry.shape} size={18} />
          </div>
          <div>
            <div className="entry-detail__title">{entry.title}</div>
            <div className="entry-detail__subtitle">
              {entry.location} · {entry.date}
            </div>
          </div>
        </div>

        <p className="entry-detail__story">{entry.story}</p>

        <div className="entry-detail__grid">
          <div className="entry-detail__field">
            <div className="entry-detail__field-label">Weather</div>
            <div className="entry-detail__field-value">{entry.weather}</div>
          </div>
          <div className="entry-detail__field">
            <div className="entry-detail__field-label">Duration</div>
            <div className="entry-detail__field-value">{entry.duration}</div>
          </div>
          <div className="entry-detail__field">
            <div className="entry-detail__field-label">Difficulty</div>
            <div className="entry-detail__field-value">{entry.difficulty}</div>
          </div>
          <div className="entry-detail__field">
            <div className="entry-detail__field-label">Participants</div>
            <div className="entry-detail__field-value">{entry.participants}</div>
          </div>
          <div className="entry-detail__field entry-detail__field--wide">
            <div className="entry-detail__field-label">Equipment</div>
            <div className="entry-detail__field-value">{entry.equipment}</div>
          </div>
        </div>

        <div className="entry-detail__section-label">Photos &amp; video</div>
        <div className="entry-detail__media">
          {entry.media.map((hint) => (
            <div key={hint} className="entry-detail__media-item">
              <PhotoPlaceholder hint={hint} shape="rounded" radius={12} />
            </div>
          ))}
        </div>

        <div className="entry-detail__section-label">Attachments</div>
        <AttachmentGallery
          attachments={attachments}
          busy={attachmentsBusy}
          status={attachmentsStatus}
          onAddPhoto={onAddPhoto}
        />

        <button type="button" className="entry-detail__raw-toggle" onClick={onToggleRaw}>
          {rawOpen ? 'Hide raw notes' : 'Show raw notes'}
        </button>
        {rawOpen && <div className="entry-detail__raw">&ldquo;{entry.raw}&rdquo;</div>}

        <div className="entry-detail__actions">
          <button
            type="button"
            className="entry-detail__action"
            disabled={exportBusy}
            onClick={() => onExportMarkdown(entry)}
          >
            Export Markdown
          </button>
          <button
            type="button"
            className="entry-detail__action"
            disabled={exportBusy}
            onClick={() => onExportPdf(entry)}
          >
            Export PDF
          </button>
        </div>

        {/* Announces the outcome of an export the user just triggered. Named
         *  distinctly from AttachmentGallery's own status region so the two
         *  aria-live regions on this screen stay individually addressable. */}
        <div className="entry-detail__status" role="status" aria-live="polite" aria-label="Export status">
          {exportStatus && (
            <span
              className={cx(
                'entry-detail__status-text',
                exportStatus.tone === 'error' && 'entry-detail__status-text--error',
              )}
            >
              {exportStatus.message}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

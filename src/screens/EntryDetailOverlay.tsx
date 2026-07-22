import { AttachmentGallery } from '../components/AttachmentGallery.tsx'
import { OverlayHeader } from '../components/OverlayHeader.tsx'
import { PhotoPlaceholder } from '../components/PhotoPlaceholder.tsx'
import { ShapeGlyph } from '../components/ShapeGlyph.tsx'
import type { AttachmentPreview, AttachmentStatus } from '../hooks/useEntryAttachments.ts'
import type { ExportStatus } from '../hooks/useExportActions.ts'
import { useIsDesktop } from '../hooks/useIsDesktop.ts'
import { cx } from '../lib/cx.ts'
import type { Entry } from '../types/entry.ts'
import { splitDetailFields } from './entryDetailFields.ts'
import './EntryDetailOverlay.css'

interface EntryDetailOverlayEmbeddedProps {
  entry: Entry
  /** Renders without the back-chevron header and without the interactive
   *  export/attachments/raw-notes sections — used for the desktop-only
   *  right-hand page that shows the most recently created entry when no
   *  overlay is open (App.tsx), which isn't a modal and has nothing to close
   *  back out of. In this mode there's no raw-notes toggle, export, or
   *  attachments UI, so none of those props exist to pass. */
  embedded: true
}

interface EntryDetailOverlayFullProps {
  entry: Entry
  embedded?: false
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

type EntryDetailOverlayProps = EntryDetailOverlayEmbeddedProps | EntryDetailOverlayFullProps

export function EntryDetailOverlay(props: EntryDetailOverlayProps) {
  const { entry } = props
  const isDesktop = useIsDesktop()
  const { statFields, gridFields } = splitDetailFields(entry)
  // The instrument-panel split is a desktop-only *reading*, not just a style —
  // below 960px every field renders in the one plain grid, exactly as before
  // this feature existed, instead of straddling the story text.
  const showStatStrip = isDesktop && statFields.length > 0
  const fieldsBelowStory = showStatStrip ? gridFields : [...statFields, ...gridFields]
  // Narrows to the full-overlay props (rawOpen/export/attachments handlers)
  // for the JSX below — `null` in embedded mode, where none of those exist.
  const full = props.embedded ? null : props

  return (
    <div className={cx('entry-detail', props.embedded && 'entry-detail--embedded')}>
      {!props.embedded && <OverlayHeader label="Back" onBack={props.onClose} />}

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

        {/* Desktop-only "instrument panel": the scannable stat fields, split
         *  out from the plain field grid below by splitDetailFields so a
         *  field never appears in both. Below 960px there's no split at all —
         *  showStatStrip is false, so every field flows into the one grid
         *  below the story, exactly as before this feature existed. */}
        {showStatStrip && (
          <div className="entry-detail__stat-strip">
            {statFields.map((field) => (
              <div key={field.label} className="entry-detail__stat-cell">
                <div className="entry-detail__stat-label">{field.label}</div>
                <div className="entry-detail__stat-value">{field.value}</div>
              </div>
            ))}
          </div>
        )}

        <p className="entry-detail__story">{entry.story}</p>

        <div className="entry-detail__grid">
          {fieldsBelowStory.map((field) => (
            <div
              key={field.label}
              className={cx(
                'entry-detail__field',
                field.label === 'Equipment' && 'entry-detail__field--wide',
              )}
            >
              <div className="entry-detail__field-label">{field.label}</div>
              <div className="entry-detail__field-value">{field.value}</div>
            </div>
          ))}
        </div>

        {full && (
          <>
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
              attachments={full.attachments ?? []}
              busy={full.attachmentsBusy ?? false}
              status={full.attachmentsStatus ?? null}
              onAddPhoto={full.onAddPhoto ?? (() => {})}
            />

            <button
              type="button"
              className="entry-detail__raw-toggle"
              onClick={full.onToggleRaw}
            >
              {full.rawOpen ? 'Hide raw notes' : 'Show raw notes'}
            </button>
            {full.rawOpen && <div className="entry-detail__raw">&ldquo;{entry.raw}&rdquo;</div>}

            <div className="entry-detail__actions">
              <button
                type="button"
                className="entry-detail__action"
                disabled={full.exportBusy ?? false}
                onClick={() => full.onExportMarkdown(entry)}
              >
                Export Markdown
              </button>
              <button
                type="button"
                className="entry-detail__action"
                disabled={full.exportBusy ?? false}
                onClick={() => full.onExportPdf(entry)}
              >
                Export PDF
              </button>
            </div>

            {/* Announces the outcome of an export the user just triggered. Named
             *  distinctly from AttachmentGallery's own status region so the two
             *  aria-live regions on this screen stay individually addressable. */}
            <div
              className="entry-detail__status"
              role="status"
              aria-live="polite"
              aria-label="Export status"
            >
              {full.exportStatus && (
                <span
                  className={cx(
                    'entry-detail__status-text',
                    full.exportStatus.tone === 'error' && 'entry-detail__status-text--error',
                  )}
                >
                  {full.exportStatus.message}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

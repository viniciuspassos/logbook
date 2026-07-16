import { OverlayHeader } from '../components/OverlayHeader.tsx'
import { PhotoPlaceholder } from '../components/PhotoPlaceholder.tsx'
import { ShapeGlyph } from '../components/ShapeGlyph.tsx'
import type { Entry } from '../types/entry.ts'
import './EntryDetailOverlay.css'

interface EntryDetailOverlayProps {
  entry: Entry
  rawOpen: boolean
  /** Disables the export buttons while another export is already in flight. */
  exportBusy?: boolean
  onToggleRaw: () => void
  onClose: () => void
  onExportMarkdown: (entry: Entry) => void
  onExportPdf: (entry: Entry) => void
}

export function EntryDetailOverlay({
  entry,
  rawOpen,
  exportBusy = false,
  onToggleRaw,
  onClose,
  onExportMarkdown,
  onExportPdf,
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
      </div>
    </div>
  )
}

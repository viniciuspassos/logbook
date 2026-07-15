import { PhotoPlaceholder } from '../components/PhotoPlaceholder.tsx'
import type { NewEntryStep } from '../hooks/useLogbookApp.ts'
import './NewEntryOverlay.css'

interface NewEntryOverlayProps {
  step: NewEntryStep
  onClose: () => void
  onStartRecording: () => void
  onSave: () => void
}

const EXTRACTED_TAGS = ['Climbing', 'Pico da Bandeira', 'Windy', 'Helmet, ropes', 'Moderate']

const POLISHED_STORY =
  'I climbed Pico da Bandeira today under a relentless wind. Helmet and ropes stayed on for the whole ascent — exhausting, but the summit made every gust worth it.'

export function NewEntryOverlay({
  step,
  onClose,
  onStartRecording,
  onSave,
}: NewEntryOverlayProps) {
  return (
    <div className="new-entry">
      <div className="new-entry__header">
        <button type="button" className="new-entry__back" onClick={onClose}>
          ‹
        </button>
        <span className="new-entry__back-label">Cancel</span>
      </div>

      {step === 'capture' && (
        <div className="new-entry__center">
          <div>
            <div className="new-entry__heading">New entry</div>
            <div className="new-entry__subheading">Tell me about your adventure</div>
          </div>
          <button
            type="button"
            className="new-entry__record"
            onClick={onStartRecording}
            aria-label="Start recording"
          >
            <span className="new-entry__record-square" />
          </button>
          <span className="new-entry__alt">Type instead</span>
        </div>
      )}

      {step === 'listening' && (
        <div className="new-entry__center">
          <div className="new-entry__record new-entry__record--pulsing" aria-hidden="true">
            <span className="new-entry__record-square" />
          </div>
          <div className="new-entry__bars" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="new-entry__status">Listening…</div>
        </div>
      )}

      {step === 'processing' && (
        <div className="new-entry__center">
          <div className="new-entry__spinner" aria-hidden="true" />
          <div className="new-entry__status new-entry__status--wide">
            Extracting details with on-device AI…
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="new-entry__review">
          <div className="new-entry__section-label">Extracted details</div>
          <div className="new-entry__tags">
            {EXTRACTED_TAGS.map((tag) => (
              <span key={tag} className="new-entry__tag">
                {tag}
              </span>
            ))}
          </div>

          <div className="new-entry__section-label">Add photos &amp; video</div>
          <div className="new-entry__media">
            <div className="new-entry__media-item">
              <PhotoPlaceholder hint="ridge shot" shape="rounded" radius={12} />
            </div>
            <div className="new-entry__media-item">
              <PhotoPlaceholder hint="summit view" shape="rounded" radius={12} />
            </div>
            <div className="new-entry__media-item">
              <PhotoPlaceholder hint="add video" shape="rounded" radius={12} />
            </div>
          </div>

          <div className="new-entry__section-label">Polished story</div>
          <div className="new-entry__story">{POLISHED_STORY}</div>

          <div className="new-entry__actions">
            <button type="button" className="new-entry__secondary">
              Regenerate
            </button>
            <button type="button" className="new-entry__primary" onClick={onSave}>
              Save entry
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

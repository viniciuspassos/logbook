import { useState } from 'react'
import { OverlayHeader } from '../components/OverlayHeader.tsx'
import { PhotoPlaceholder } from '../components/PhotoPlaceholder.tsx'
import type { NewEntryStep } from '../hooks/useNewEntryFlow.ts'
import type { Draft } from '../lib/buildEntry.ts'
import type { ExtractedEntryFields } from '../lib/ai/extractEntry.ts'
import './NewEntryOverlay.css'

interface NewEntryOverlayProps {
  step: NewEntryStep
  draft: Draft
  captureError: string | null
  isRegenerating: boolean
  transcript: string
  interimTranscript: string
  onClose: () => void
  onStartRecording: () => void
  onStopRecording: () => void
  onSubmitTyped: (text: string) => void
  onRegenerate: () => void
  onEditStory: (text: string) => void
  onSave: () => void
}

function extractedTags(extracted: ExtractedEntryFields): string[] {
  return [
    extracted.activityType,
    extracted.location,
    extracted.weather,
    extracted.equipment,
    extracted.difficulty,
  ]
    .map((value) => value.trim())
    .filter(Boolean)
}

export function NewEntryOverlay({
  step,
  draft,
  captureError,
  isRegenerating,
  transcript,
  interimTranscript,
  onClose,
  onStartRecording,
  onStopRecording,
  onSubmitTyped,
  onRegenerate,
  onEditStory,
  onSave,
}: NewEntryOverlayProps) {
  const [mode, setMode] = useState<'voice' | 'text'>('voice')
  const [typed, setTyped] = useState('')

  const tags = draft.extracted ? extractedTags(draft.extracted) : []

  return (
    <div className="new-entry">
      <OverlayHeader label="Cancel" onBack={onClose} />

      {step === 'capture' && (
        <div className="new-entry__center">
          <div>
            <div className="new-entry__heading">New entry</div>
            <div className="new-entry__subheading">Tell me about your adventure</div>
          </div>

          {captureError && (
            <p className="new-entry__error" role="alert">
              {captureError}
            </p>
          )}

          {mode === 'voice' ? (
            <>
              <button
                type="button"
                className="new-entry__record"
                onClick={onStartRecording}
                aria-label="Start recording"
              >
                <span className="new-entry__record-square" />
              </button>
              <button
                type="button"
                className="new-entry__alt"
                onClick={() => setMode('text')}
              >
                Type instead
              </button>
            </>
          ) : (
            <div className="new-entry__type">
              <textarea
                className="new-entry__textarea"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="Type a few notes about your adventure…"
                aria-label="Adventure notes"
                rows={5}
              />
              <div className="new-entry__type-actions">
                <button
                  type="button"
                  className="new-entry__alt"
                  onClick={() => setMode('voice')}
                >
                  Use voice instead
                </button>
                <button
                  type="button"
                  className="new-entry__primary"
                  onClick={() => onSubmitTyped(typed)}
                  disabled={!typed.trim()}
                >
                  Extract details
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 'listening' && (
        <div className="new-entry__center">
          <button
            type="button"
            className="new-entry__record new-entry__record--pulsing"
            onClick={onStopRecording}
            aria-label="Stop recording"
          >
            <span className="new-entry__record-square" />
          </button>
          <div className="new-entry__bars" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="new-entry__status" role="status" aria-live="polite">
            Listening… tap to finish
          </div>
          <p className="new-entry__transcript" aria-live="polite">
            {transcript}
            <span className="new-entry__transcript-interim">{interimTranscript}</span>
          </p>
        </div>
      )}

      {step === 'processing' && (
        <div className="new-entry__center">
          <div className="new-entry__spinner" aria-hidden="true" />
          <div
            className="new-entry__status new-entry__status--wide"
            role="status"
            aria-live="polite"
          >
            Extracting details with on-device AI…
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="new-entry__review">
          <div className="new-entry__section-label">Extracted details</div>
          <div className="new-entry__tags">
            {draft.extracted ? (
              tags.map((tag) => (
                <span key={tag} className="new-entry__tag">
                  {tag}
                </span>
              ))
            ) : (
              <span className="new-entry__tag">Manual entry</span>
            )}
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

          <div className="new-entry__section-label">
            {draft.extracted ? 'Polished story' : 'Your story'}
          </div>
          {draft.extracted ? (
            <p className="new-entry__story">{draft.story}</p>
          ) : (
            <textarea
              className="new-entry__textarea"
              value={draft.story}
              onChange={(event) => onEditStory(event.target.value)}
              aria-label="Story"
              rows={5}
            />
          )}

          <div className="new-entry__actions">
            <button
              type="button"
              className="new-entry__secondary"
              onClick={onRegenerate}
              disabled={isRegenerating || !draft.extracted}
            >
              {isRegenerating ? 'Regenerating…' : 'Regenerate'}
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

import { useEffect, useMemo, useState } from 'react'
import { OverlayHeader } from '../components/OverlayHeader.tsx'
import { PhotoPlaceholder } from '../components/PhotoPlaceholder.tsx'
import type { NewEntryStep } from '../hooks/useNewEntryFlow.ts'
import { DEFAULT_MEDIA_HINTS, deriveTitle, type Draft } from '../lib/buildEntry.ts'
import type { ExtractedEntryFields } from '../lib/ai/extractEntry.ts'
import './NewEntryOverlay.css'

interface NewEntryOverlayProps {
  step: NewEntryStep
  draft: Draft
  captureError: string | null
  isRegenerating: boolean
  photos: File[]
  photoError: string | null
  transcript: string
  interimTranscript: string
  onClose: () => void
  onStartRecording: () => void
  onStopRecording: () => void
  onSubmitTyped: (text: string) => void
  onRegenerate: () => void
  onEditStory: (text: string) => void
  onEditTitle: (title: string) => void
  onAddPhotos: (files: File[]) => void
  onRemovePhoto: (index: number) => void
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

/** Object URLs for the chosen photos, revoked when the set changes or the overlay closes. */
function usePhotoUrls(photos: File[]): string[] {
  const urls = useMemo(
    () =>
      typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
        ? photos.map((photo) => URL.createObjectURL(photo))
        : photos.map(() => ''),
    [photos],
  )
  useEffect(
    () => () => {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        urls.forEach((url) => url && URL.revokeObjectURL(url))
      }
    },
    [urls],
  )
  return urls
}

export function NewEntryOverlay({
  step,
  draft,
  captureError,
  isRegenerating,
  photos,
  photoError,
  transcript,
  interimTranscript,
  onClose,
  onStartRecording,
  onStopRecording,
  onSubmitTyped,
  onRegenerate,
  onEditStory,
  onEditTitle,
  onAddPhotos,
  onRemovePhoto,
  onSave,
}: NewEntryOverlayProps) {
  const [mode, setMode] = useState<'voice' | 'text'>('voice')
  const [typed, setTyped] = useState('')

  const photoUrls = usePhotoUrls(photos)
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

          <label className="new-entry__section-label" htmlFor="new-entry-title">
            Title
          </label>
          <input
            id="new-entry-title"
            className="new-entry__input"
            type="text"
            value={draft.title ?? deriveTitle(draft.extracted, draft.raw)}
            onChange={(event) => onEditTitle(event.target.value)}
          />

          <div className="new-entry__section-label">Add photos</div>
          {photos.length === 0 ? (
            <div className="new-entry__media">
              {DEFAULT_MEDIA_HINTS.map((hint) => (
                <div className="new-entry__media-item" key={hint}>
                  <PhotoPlaceholder hint={hint} shape="rounded" radius={12} />
                </div>
              ))}
            </div>
          ) : (
            <ul className="new-entry__media">
              {photos.map((photo, index) => (
                <li className="new-entry__media-item" key={`${photo.name}-${index}`}>
                  <img src={photoUrls[index]} alt={photo.name} className="new-entry__photo" />
                  <button
                    type="button"
                    className="new-entry__photo-remove"
                    aria-label={`Remove ${photo.name}`}
                    onClick={() => onRemovePhoto(index)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="new-entry__secondary new-entry__add-photo">
            Choose photos
            <input
              type="file"
              accept="image/*"
              multiple
              className="new-entry__file"
              onChange={(event) => {
                onAddPhotos(Array.from(event.target.files ?? []))
                event.target.value = ''
              }}
            />
          </label>
          {photoError && (
            <p className="new-entry__error" role="alert">
              {photoError}
            </p>
          )}

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

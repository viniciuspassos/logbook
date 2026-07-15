import type { KeyboardEvent } from 'react'
import { AdventureBadge } from './AdventureBadge.tsx'
import { PhotoPlaceholder } from './PhotoPlaceholder.tsx'
import type { Entry } from '../types/entry.ts'
import './EntryCard.css'

interface EntryCardProps {
  entry: Entry
  onOpen: () => void
  showExcerpt?: boolean
}

export function EntryCard({ entry, onOpen, showExcerpt = true }: EntryCardProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen()
    }
  }

  return (
    <div
      className="entry-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
    >
      <div className="entry-card__thumb">
        <PhotoPlaceholder hint={entry.photoHint} shape="rounded" radius={14} />
        <div className="entry-card__badge">
          <AdventureBadge shape={entry.shape} />
        </div>
      </div>
      <div className="entry-card__body">
        <div className="entry-card__row">
          <span className="entry-card__title">{entry.title}</span>
          <span className="entry-card__date">{entry.date}</span>
        </div>
        <div className="entry-card__meta">
          {entry.location} · {entry.metric}
        </div>
        {showExcerpt && <p className="entry-card__excerpt">{entry.excerpt}</p>}
      </div>
    </div>
  )
}

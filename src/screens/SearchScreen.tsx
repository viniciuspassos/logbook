import { useState } from 'react'
import { EntryCard } from '../components/EntryCard.tsx'
import { filterEntries } from '../lib/filterEntries.ts'
import type { Entry } from '../types/entry.ts'
import './SearchScreen.css'

interface SearchScreenProps {
  entries: Entry[]
  onOpenEntry: (id: number) => void
}

const QUICK_TAGS = ['windy', 'solo', 'multi-day']

export function SearchScreen({ entries, onOpenEntry }: SearchScreenProps) {
  const [query, setQuery] = useState('')
  const results = filterEntries(entries, query)

  function toggleTag(tag: string) {
    setQuery((current) => (current.toLowerCase() === tag ? '' : tag))
  }

  return (
    <div className="search-screen">
      <h1 className="search-screen__title">Search</h1>
      <input
        className="search-screen__input"
        type="search"
        placeholder="Search 'windy climbs in July'"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search entries"
      />
      <div className="search-screen__tags">
        {QUICK_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            className={`search-screen__tag${query.toLowerCase() === tag ? ' is-active' : ''}`}
            onClick={() => toggleTag(tag)}
          >
            {tag}
          </button>
        ))}
      </div>
      <div className="search-screen__section-label">
        {query
          ? `${results.length} result${results.length === 1 ? '' : 's'}`
          : 'All entries'}
      </div>
      <div className="search-screen__list">
        {results.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            onOpen={() => onOpenEntry(entry.id)}
            showExcerpt={false}
          />
        ))}
        {results.length === 0 && (
          <p className="search-screen__empty">No entries match &ldquo;{query}&rdquo;.</p>
        )}
      </div>
    </div>
  )
}

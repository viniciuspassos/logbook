import { useEffect, useState } from 'react'
import { EntryCard } from '../components/EntryCard.tsx'
import { cx } from '../lib/cx.ts'
import { filterEntries } from '../lib/filterEntries.ts'
import { applySearchCriteria, parseSearchQuery } from '../lib/ai/searchEntries.ts'
import type { Entry } from '../types/entry.ts'
import './SearchScreen.css'

interface SearchScreenProps {
  entries: Entry[]
  onOpenEntry: (id: number) => void
}

const QUICK_TAGS = ['windy', 'solo', 'multi-day']
const DEBOUNCE_MS = 250

export function SearchScreen({ entries, onOpenEntry }: SearchScreenProps) {
  const [query, setQuery] = useState('')
  // AI-parsed results for a specific query; instant substring results show
  // until this resolves, and AI absence degrades to that same behavior.
  const [aiResults, setAiResults] = useState<{ query: string; entries: Entry[] } | null>(
    null,
  )

  useEffect(() => {
    const trimmed = query.trim()
    // No synchronous reset here: a stale aiResults is ignored below because its
    // `.query` no longer matches the current query.
    if (!trimmed) return
    let cancelled = false
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void parseSearchQuery(trimmed, { signal: controller.signal }).then((criteria) => {
        if (cancelled) return
        setAiResults({ query, entries: applySearchCriteria(entries, criteria) })
      })
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      controller.abort()
      clearTimeout(timer)
    }
  }, [query, entries])

  const substringResults = filterEntries(entries, query)
  const results =
    aiResults && aiResults.query === query ? aiResults.entries : substringResults

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
            className={cx('search-screen__tag', query.toLowerCase() === tag && 'is-active')}
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

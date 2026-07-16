import { useState } from 'react'
import type { Entry } from '../types/entry.ts'

export type Tab = 'timeline' | 'search' | 'stats' | 'settings'
export type Overlay = 'entry' | 'newEntry' | null
export type TimelineView = 'list' | 'map'

/**
 * Tab/overlay navigation and entry-detail view state. Split out of the former
 * `useLogbookApp` god hook so the new-entry AI flow can layer on cleanly.
 */
export function useNavigation(entries: Entry[]) {
  const [tab, setTab] = useState<Tab>('timeline')
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [entryId, setEntryId] = useState<number | null>(null)
  const [rawOpen, setRawOpen] = useState(false)
  const [timelineView, setTimelineView] = useState<TimelineView>('list')

  function goTab(next: Tab) {
    setTab(next)
    setOverlay(null)
  }

  function openEntry(id: number) {
    setOverlay('entry')
    setEntryId(id)
    setRawOpen(false)
  }

  function closeOverlay() {
    setOverlay(null)
  }

  function toggleRaw() {
    setRawOpen((open) => !open)
  }

  function openNewEntryOverlay() {
    setOverlay('newEntry')
  }

  function goTimeline() {
    setTab('timeline')
    setOverlay(null)
  }

  // No silent `entries[0]` fallback: an unknown id yields an explicit null so a
  // stale/missing selection surfaces instead of masquerading as the first entry.
  const selectedEntry: Entry | null =
    entryId === null ? null : (entries.find((entry) => entry.id === entryId) ?? null)

  return {
    tab,
    overlay,
    rawOpen,
    timelineView,
    selectedEntry,
    setTimelineView,
    goTab,
    openEntry,
    closeOverlay,
    toggleRaw,
    openNewEntryOverlay,
    goTimeline,
  }
}

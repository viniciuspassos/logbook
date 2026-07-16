import { useState } from 'react'
import { entries as seedEntries } from '../data/entries.ts'
import { buildEntryFromDraft } from '../lib/buildEntry.ts'
import type { Entry } from '../types/entry.ts'
import { useNavigation } from './useNavigation.ts'
import { useNewEntryFlow } from './useNewEntryFlow.ts'

export type { Tab, Overlay, TimelineView } from './useNavigation.ts'
export type { NewEntryStep } from './useNewEntryFlow.ts'

/**
 * Top-level app state: composes navigation and the new-entry AI flow, and owns
 * the (currently in-memory) entries list. `entries` is `useState`-backed so a
 * saved entry is visible immediately; IndexedDB persistence is a later phase
 * that swaps only the storage without touching this coordination logic.
 */
export function useLogbookApp() {
  const [entries, setEntries] = useState<Entry[]>(seedEntries)
  const nav = useNavigation(entries)
  const flow = useNewEntryFlow()

  function openNewEntry() {
    flow.reset()
    nav.openNewEntryOverlay()
  }

  function closeOverlay() {
    flow.abort()
    nav.closeOverlay()
  }

  function saveEntry() {
    const nextId = entries.reduce((max, entry) => Math.max(max, entry.id), 0) + 1
    const entry = buildEntryFromDraft(flow.draft, { id: nextId, date: new Date() })
    setEntries((prev) => [entry, ...prev])
    flow.reset()
    nav.goTimeline()
  }

  return {
    // navigation + data
    tab: nav.tab,
    overlay: nav.overlay,
    timelineView: nav.timelineView,
    rawOpen: nav.rawOpen,
    entries,
    selectedEntry: nav.selectedEntry,
    goTab: nav.goTab,
    setTimelineView: nav.setTimelineView,
    openEntry: nav.openEntry,
    toggleRaw: nav.toggleRaw,
    closeOverlay,
    openNewEntry,
    saveEntry,
    // new-entry flow
    newStep: flow.step,
    draft: flow.draft,
    captureError: flow.captureError,
    isRegenerating: flow.isRegenerating,
    listening: flow.listening,
    transcript: flow.transcript,
    interimTranscript: flow.interimTranscript,
    startRecording: flow.startRecording,
    stopRecording: flow.stopRecording,
    submitTyped: flow.submitTyped,
    regenerateStory: flow.regenerateStory,
    editStory: flow.editStory,
  }
}

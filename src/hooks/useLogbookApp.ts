import { entries as seedEntries } from '../data/entries.ts'
import { buildEntryFromDraft } from '../lib/buildEntry.ts'
import { useEntries } from './useEntries.ts'
import { useNavigation } from './useNavigation.ts'
import { useNewEntryFlow } from './useNewEntryFlow.ts'

export type { Tab, Overlay, TimelineView } from './useNavigation.ts'
export type { NewEntryStep } from './useNewEntryFlow.ts'

/**
 * Top-level app state: composes navigation, the persisted entries list, and the
 * new-entry AI flow. Entries load from (and write through to) IndexedDB via
 * `useEntries`; this hook only coordinates when a new one is built and saved.
 */
export function useLogbookApp() {
  const { entries, addEntry } = useEntries(seedEntries)
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
    addEntry(entry)
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

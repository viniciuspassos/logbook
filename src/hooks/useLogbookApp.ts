import { entries as seedEntries } from '../data/entries.ts'
import { buildEntryFromDraft } from '../lib/buildEntry.ts'
import { useEntries } from './useEntries.ts'
import { useExportActions } from './useExportActions.ts'
import { useNavigation } from './useNavigation.ts'
import { useNewEntryFlow } from './useNewEntryFlow.ts'

export type { Tab, Overlay, TimelineView } from './useNavigation.ts'
export type { NewEntryStep } from './useNewEntryFlow.ts'

/**
 * Top-level app state: composes navigation, the persisted entries list, the
 * new-entry AI flow, and the export/backup actions. Entries load from (and
 * write through to) IndexedDB via `useEntries`; this hook only coordinates
 * when a new one is built and saved.
 */
export function useLogbookApp() {
  const { entries, addEntry, replaceEntries } = useEntries(seedEntries)
  const nav = useNavigation(entries)
  const flow = useNewEntryFlow()
  // Restoring a backup replaces the whole list, so a stale detail overlay
  // could be pointing at an entry that no longer exists — close it first.
  const exportActions = useExportActions(entries, {
    onRestore: async (restored) => {
      nav.closeOverlay()
      await replaceEntries(restored)
    },
  })

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
    // exports & backup
    exportActions,
  }
}

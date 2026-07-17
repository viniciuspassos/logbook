import { entries as seedEntries } from '../data/entries.ts'
import { buildEntryFromDraft } from '../lib/buildEntry.ts'
import { useEntries } from './useEntries.ts'
import { useEntryAttachments } from './useEntryAttachments.ts'
import { useExportActions } from './useExportActions.ts'
import { useNavigation } from './useNavigation.ts'
import { useNewEntryFlow } from './useNewEntryFlow.ts'
import { useSyncOutbox } from './useSyncOutbox.ts'

export type { Tab, Overlay, TimelineView } from './useNavigation.ts'
export type { NewEntryStep } from './useNewEntryFlow.ts'
export type { AttachmentPreview, AttachmentStatus } from './useEntryAttachments.ts'

/**
 * Top-level app state: composes navigation, the persisted entries list, the
 * new-entry AI flow, the export/backup actions, and (#26) the background
 * server-sync outbox + the attachment gallery for whichever entry is open.
 * Entries load from (and write through to) IndexedDB via `useEntries`, which
 * stays the sole local source of truth; `useSyncOutbox` layers an additive,
 * best-effort server sync on top without this hook knowing outbox internals.
 */
export function useLogbookApp() {
  const { entries, addEntry, replaceEntries } = useEntries(seedEntries)
  const nav = useNavigation(entries)
  const flow = useNewEntryFlow()
  const syncOutbox = useSyncOutbox()
  const attachments = useEntryAttachments(nav.selectedEntry)
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
    syncOutbox.queueEntryCreate(entry)
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
    // attachments (#26) — the gallery for whichever entry `selectedEntry` is
    attachments,
  }
}

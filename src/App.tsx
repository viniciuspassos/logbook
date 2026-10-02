import { TabBar } from './components/TabBar.tsx'
import { mostRecentEntry } from './hooks/useEntries.ts'
import { useIsDesktop } from './hooks/useIsDesktop.ts'
import { useLogbookApp } from './hooks/useLogbookApp.ts'
import { EntryDetailOverlay } from './screens/EntryDetailOverlay.tsx'
import { NewEntryOverlay } from './screens/NewEntryOverlay.tsx'
import { SearchScreen } from './screens/SearchScreen.tsx'
import { SettingsScreen } from './screens/SettingsScreen.tsx'
import { StatsScreen } from './screens/StatsScreen.tsx'
import { TimelineScreen } from './screens/TimelineScreen.tsx'
import './App.css'

function App() {
  const {
    tab,
    overlay,
    timelineView,
    rawOpen,
    newStep,
    draft,
    captureError,
    isRegenerating,
    transcript,
    interimTranscript,
    entries,
    selectedEntry,
    goTab,
    setTimelineView,
    openEntry,
    closeOverlay,
    toggleRaw,
    openNewEntry,
    startRecording,
    stopRecording,
    submitTyped,
    regenerateStory,
    editStory,
    saveEntry,
    deleteEntry,
    exportActions,
    attachments,
    auth,
    syncStatus,
  } = useLogbookApp()
  const isDesktop = useIsDesktop()
  // Below the desktop breakpoint an overlay is a full-screen cover, so the
  // rail underneath must unmount (both visually and from focus/AT). At
  // desktop width the overlay is just the reading panel next to the list,
  // so the nav rail — and the ability to switch tabs or close out to a new
  // entry — stays put instead of disappearing while reading.
  const showTabBar = isDesktop || !overlay
  // Desktop-only: the reading panel defaults to showing the latest entry
  // read-only instead of a static hint, whenever no overlay has it covered.
  const latestEntry = isDesktop ? mostRecentEntry(entries) : undefined
  // Whichever entry the reading panel shows gets its list row marked, so the
  // list and the panel read as one connected surface. The new-entry form
  // shows no entry, so no row is marked while it's open.
  const shownEntry = overlay === 'entry' ? selectedEntry : overlay ? null : latestEntry
  const readingId = shownEntry?.id

  return (
    <div className="app">
      <div className="app-screen">
        {tab === 'timeline' && (
          <TimelineScreen
            syncStatus={syncStatus}
            entries={entries}
            selectedId={readingId}
            timelineView={timelineView}
            onChangeView={setTimelineView}
            onOpenEntry={openEntry}
          />
        )}
        {tab === 'search' && <SearchScreen entries={entries} onOpenEntry={openEntry} />}
        {tab === 'stats' && <StatsScreen entries={entries} />}
        {tab === 'settings' && (
          <SettingsScreen entryCount={entries.length} exports={exportActions} auth={auth} />
        )}
      </div>

      {showTabBar && <TabBar active={tab} onSelect={goTab} onNewEntry={openNewEntry} />}

      {!overlay && latestEntry && (
        <EntryDetailOverlay entry={latestEntry} embedded />
      )}
      {!overlay && !latestEntry && (
        <div className="reading-empty">
          <p className="reading-empty__hint">Open an entry to read it here</p>
        </div>
      )}

      {overlay === 'entry' && selectedEntry && (
        <EntryDetailOverlay
          entry={selectedEntry}
          rawOpen={rawOpen}
          exportBusy={exportActions.busy}
          exportStatus={exportActions.status}
          onToggleRaw={toggleRaw}
          onClose={closeOverlay}
          onExportMarkdown={exportActions.exportEntryMarkdown}
          onExportPdf={exportActions.exportEntryPdf}
          attachments={attachments.attachments}
          attachmentsBusy={attachments.busy}
          attachmentsStatus={attachments.status}
          onAddPhoto={attachments.addPhoto}
          onDiscardPhoto={attachments.discardPhoto}
          onRemovePhoto={attachments.removePhoto}
          onDelete={(entry) => deleteEntry(entry.id)}
        />
      )}
      {overlay === 'newEntry' && (
        <NewEntryOverlay
          step={newStep}
          draft={draft}
          captureError={captureError}
          isRegenerating={isRegenerating}
          transcript={transcript}
          interimTranscript={interimTranscript}
          onClose={closeOverlay}
          onStartRecording={startRecording}
          onStopRecording={stopRecording}
          onSubmitTyped={submitTyped}
          onRegenerate={regenerateStory}
          onEditStory={editStory}
          onSave={saveEntry}
        />
      )}
    </div>
  )
}

export default App

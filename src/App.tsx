import { TabBar } from './components/TabBar.tsx'
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
    exportActions,
    attachments,
  } = useLogbookApp()
  const isDesktop = useIsDesktop()
  // Below the desktop breakpoint an overlay is a full-screen cover, so the
  // rail underneath must unmount (both visually and from focus/AT). At
  // desktop width the overlay is just the right-hand page next to the list,
  // so the spine rail — and the ability to switch tabs or close out to a new
  // entry — stays put instead of disappearing while reading.
  const showTabBar = isDesktop || !overlay

  return (
    <div className="app">
      <div className="app-screen">
        {tab === 'timeline' && (
          <TimelineScreen
            entries={entries}
            timelineView={timelineView}
            onChangeView={setTimelineView}
            onOpenEntry={openEntry}
          />
        )}
        {tab === 'search' && <SearchScreen entries={entries} onOpenEntry={openEntry} />}
        {tab === 'stats' && <StatsScreen entries={entries} />}
        {tab === 'settings' && (
          <SettingsScreen entryCount={entries.length} exports={exportActions} />
        )}
      </div>

      {showTabBar && <TabBar active={tab} onSelect={goTab} onNewEntry={openNewEntry} />}

      {!overlay && (
        <div className="book-right-page">
          <div className="book-right-page__rings" aria-hidden="true" />
          <p className="book-right-page__hint">Open an entry to read it here</p>
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

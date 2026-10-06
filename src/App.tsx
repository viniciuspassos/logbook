import { useState } from 'react'
import { cx } from './lib/cx.ts'
import { SignInBanner } from './components/SignInBanner.tsx'
import { TabBar } from './components/TabBar.tsx'
import { mostRecentEntry } from './hooks/useEntries.ts'
import { useIsDesktop } from './hooks/useIsDesktop.ts'
import { useLogbookApp } from './hooks/useLogbookApp.ts'
import { LoginScreen } from './screens/LoginScreen.tsx'
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
    photos,
    photoError,
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
    editTitle,
    addPhotos,
    removeNewEntryPhoto,
    saveEntry,
    deleteEntry,
    exportActions,
    attachments,
    auth,
    syncStatus,
  } = useLogbookApp()
  const isDesktop = useIsDesktop()
  // Pure UI: whether the "sign in again" screen is open over the running app.
  const [reauthOpen, setReauthOpen] = useState(false)
  // Once the session is good again, forget that the screen was open, so the
  // next background 401 shows just the banner (adjusting state while rendering
  // is React's pattern for deriving state from a prop).
  if (!auth.needsSignIn && reauthOpen) setReauthOpen(false)

  // The sign-in gate (#122): the shell only opens with a known identity. It
  // keys off `auth.state`, which counts a cached profile (or local entries) on
  // this device as known, so reopening offline never lands here, and a
  // background 401 only raises the banner below instead of unmounting the app
  // (it would lose an in-progress draft) — see useAuth.ts and
  // docs/ARCHITECTURE.md. The hooks above stay mounted, so local data and the
  // outbox are untouched while the gate is up.
  if (auth.state === 'loading') {
    return (
      <main className="splash">
        <p className="splash__text" role="status" aria-live="polite">
          Opening Logbook…
        </p>
      </main>
    )
  }
  if (auth.state === 'signedOut') {
    return (
      <LoginScreen
        pending={auth.pending}
        error={auth.error}
        onCredential={auth.signInWithGoogle}
        pendingSwitch={auth.pendingSwitch}
        onConfirmSwitch={auth.confirmSwitch}
        onCancelSwitch={auth.cancelSwitch}
      />
    )
  }

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
    <>
    {auth.needsSignIn && <SignInBanner onSignIn={() => setReauthOpen(true)} />}
    {auth.needsSignIn && reauthOpen && (
      <div className="reauth">
        <LoginScreen
          pending={auth.pending}
          error={auth.error}
          onCredential={auth.signInWithGoogle}
          pendingSwitch={auth.pendingSwitch}
          onConfirmSwitch={auth.confirmSwitch}
          onCancelSwitch={auth.cancelSwitch}
          onDismiss={() => setReauthOpen(false)}
        />
      </div>
    )}
    <div className={cx('app', auth.needsSignIn && 'app--with-banner')}>
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
          photos={photos}
          photoError={photoError}
          transcript={transcript}
          interimTranscript={interimTranscript}
          onClose={closeOverlay}
          onStartRecording={startRecording}
          onStopRecording={stopRecording}
          onSubmitTyped={submitTyped}
          onRegenerate={regenerateStory}
          onEditStory={editStory}
          onEditTitle={editTitle}
          onAddPhotos={addPhotos}
          onRemovePhoto={removeNewEntryPhoto}
          onSave={saveEntry}
        />
      )}
    </div>
    </>
  )
}

export default App

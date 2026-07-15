import { TabBar } from './components/TabBar.tsx'
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
    entries,
    selectedEntry,
    goTab,
    setTimelineView,
    openEntry,
    closeOverlay,
    toggleRaw,
    openNewEntry,
    startRecording,
    saveEntry,
  } = useLogbookApp()

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
        {tab === 'stats' && <StatsScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </div>

      {!overlay && <TabBar active={tab} onSelect={goTab} onNewEntry={openNewEntry} />}

      {overlay === 'entry' && (
        <EntryDetailOverlay
          entry={selectedEntry}
          rawOpen={rawOpen}
          onToggleRaw={toggleRaw}
          onClose={closeOverlay}
        />
      )}
      {overlay === 'newEntry' && (
        <NewEntryOverlay
          step={newStep}
          onClose={closeOverlay}
          onStartRecording={startRecording}
          onSave={saveEntry}
        />
      )}
    </div>
  )
}

export default App

import { useEffect, useRef, useState } from 'react'
import { entries } from '../data/entries.ts'
import type { Entry } from '../types/entry.ts'

export type Tab = 'timeline' | 'search' | 'stats' | 'settings'
export type Overlay = 'entry' | 'newEntry' | null
export type TimelineView = 'list' | 'map'
export type NewEntryStep = 'capture' | 'listening' | 'processing' | 'review'

const LISTENING_MS = 1400
const PROCESSING_MS = 1400

export function useLogbookApp() {
  const [tab, setTab] = useState<Tab>('timeline')
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [entryId, setEntryId] = useState<number | null>(null)
  const [rawOpen, setRawOpen] = useState(false)
  const [timelineView, setTimelineView] = useState<TimelineView>('list')
  const [newStep, setNewStep] = useState<NewEntryStep>('capture')

  const listeningTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const processingTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(
    () => () => {
      clearTimeout(listeningTimer.current)
      clearTimeout(processingTimer.current)
    },
    [],
  )

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

  function openNewEntry() {
    setOverlay('newEntry')
    setNewStep('capture')
  }

  function startRecording() {
    setNewStep('listening')
    clearTimeout(listeningTimer.current)
    clearTimeout(processingTimer.current)
    listeningTimer.current = setTimeout(() => {
      setNewStep('processing')
    }, LISTENING_MS)
    processingTimer.current = setTimeout(() => {
      setNewStep('review')
    }, LISTENING_MS + PROCESSING_MS)
  }

  function saveEntry() {
    setOverlay(null)
    setTab('timeline')
    setNewStep('capture')
  }

  const selectedEntry: Entry =
    entries.find((entry) => entry.id === entryId) ?? entries[0]

  return {
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
  }
}

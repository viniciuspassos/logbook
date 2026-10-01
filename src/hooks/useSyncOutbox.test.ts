import { act, renderHook } from '@testing-library/react'
import { useSyncOutbox } from './useSyncOutbox.ts'
import { drainOutbox, startAutoSync, subscribeToDrains } from '../lib/sync/outboxRunner.ts'
import { queueEntryCreate, queueEntryCreates } from '../lib/sync/outboxQueue.ts'
import type { Entry } from '../types/entry.ts'

jest.mock('../lib/sync/outboxRunner.ts', () => ({
  drainOutbox: jest.fn().mockResolvedValue({ processed: 0, stoppedReason: 'empty' }),
  startAutoSync: jest.fn().mockReturnValue(jest.fn()),
  subscribeToDrains: jest.fn().mockReturnValue(jest.fn()),
}))
jest.mock('../lib/sync/outboxQueue.ts', () => ({
  queueEntryCreate: jest.fn().mockResolvedValue(undefined),
  queueEntryCreates: jest.fn().mockResolvedValue(undefined),
}))

const drainMock = drainOutbox as jest.Mock
const startAutoSyncMock = startAutoSync as jest.Mock
const subscribeMock = subscribeToDrains as jest.Mock
const queueEntryCreateMock = queueEntryCreate as jest.Mock
const queueEntryCreatesMock = queueEntryCreates as jest.Mock

function makeEntry(id: number): Entry {
  return {
    id,
    title: 'Summit day',
    shape: 'triangle',
    location: 'Alps',
    date: 'Jul 3',
    metric: '',
    excerpt: '',
    weather: '',
    duration: '',
    difficulty: '',
    equipment: '',
    participants: '',
    raw: '',
    story: '',
    photoHint: '',
    media: ['a', 'b', 'c'],
    mapX: 50,
    mapY: 50,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  drainMock.mockResolvedValue({ processed: 0, stoppedReason: 'empty' })
  startAutoSyncMock.mockReturnValue(jest.fn())
  subscribeMock.mockReturnValue(jest.fn())
  queueEntryCreateMock.mockResolvedValue(undefined)
  queueEntryCreatesMock.mockResolvedValue(undefined)
})

describe('useSyncOutbox', () => {
  it('reports "Saved locally" until a drain says otherwise, then follows each outcome', () => {
    const { result } = renderHook(() => useSyncOutbox())
    expect(result.current.syncStatus).toBe('Saved locally')
    const listener = subscribeMock.mock.calls[0][0]

    act(() => listener({ processed: 1, stoppedReason: 'empty' }))
    expect(result.current.syncStatus).toBe('Saved locally · synced')

    act(() => listener({ processed: 0, stoppedReason: 'auth' }))
    expect(result.current.syncStatus).toBe('Saved locally · sign in to sync')
  })

  it('keeps the last real outcome when a drain is aborted', () => {
    const { result } = renderHook(() => useSyncOutbox())
    const listener = subscribeMock.mock.calls[0][0]

    act(() => listener({ processed: 0, stoppedReason: 'empty' }))
    act(() => listener({ processed: 0, stoppedReason: 'aborted' }))
    expect(result.current.syncStatus).toBe('Saved locally · synced')
  })

  it('unsubscribes from drain outcomes on unmount', () => {
    const unsubscribe = jest.fn()
    subscribeMock.mockReturnValue(unsubscribe)
    const { unmount } = renderHook(() => useSyncOutbox())
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('registers the online-reconnect listener and does an initial drain on mount', () => {
    renderHook(() => useSyncOutbox())
    expect(startAutoSyncMock).toHaveBeenCalledTimes(1)
    expect(drainMock).toHaveBeenCalledTimes(1)
  })

  it('cleans up the online listener on unmount', () => {
    const cleanup = jest.fn()
    startAutoSyncMock.mockReturnValue(cleanup)
    const { unmount } = renderHook(() => useSyncOutbox())
    unmount()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('queueEntryCreates enqueues every entry and kicks a single drain', async () => {
    const { result } = renderHook(() => useSyncOutbox())
    drainMock.mockClear()

    await act(async () => {
      result.current.queueEntryCreates([makeEntry(1), makeEntry(2)])
    })

    expect(queueEntryCreatesMock).toHaveBeenCalledWith([makeEntry(1), makeEntry(2)])
    expect(drainMock).toHaveBeenCalledTimes(1)
  })

  it('queueEntryCreates still drains and never rejects when queueing throws', async () => {
    queueEntryCreatesMock.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useSyncOutbox())
    drainMock.mockClear()

    await act(async () => {
      result.current.queueEntryCreates([makeEntry(1)])
    })

    expect(drainMock).toHaveBeenCalledTimes(1)
  })

  it('queueEntryCreate enqueues the entry and kicks a drain', async () => {
    const { result } = renderHook(() => useSyncOutbox())
    drainMock.mockClear()

    await act(async () => {
      result.current.queueEntryCreate(makeEntry(1))
    })

    expect(queueEntryCreateMock).toHaveBeenCalledWith(makeEntry(1))
    expect(drainMock).toHaveBeenCalled()
  })

  it('queueEntryCreate never throws even if queuing fails', async () => {
    queueEntryCreateMock.mockRejectedValue(new Error('storage full'))
    const { result } = renderHook(() => useSyncOutbox())

    await act(async () => {
      expect(() => result.current.queueEntryCreate(makeEntry(1))).not.toThrow()
    })
  })

  describe('auth reporting', () => {
    function renderWithAuth() {
      const onAuthRequired = jest.fn()
      const onAuthConfirmed = jest.fn()
      renderHook(() => useSyncOutbox({ onAuthRequired, onAuthConfirmed }))
      const listener = subscribeMock.mock.calls[0][0]
      return { onAuthRequired, onAuthConfirmed, listener }
    }

    it('calls onAuthRequired when any drain finds the session is gone, wherever it started', () => {
      const { onAuthRequired, onAuthConfirmed, listener } = renderWithAuth()
      act(() => listener({ processed: 0, stoppedReason: 'auth', error: 'Authentication required.' }))
      expect(onAuthRequired).toHaveBeenCalledTimes(1)
      expect(onAuthConfirmed).not.toHaveBeenCalled()
    })

    it('calls onAuthConfirmed when a drain actually processed something', () => {
      const { onAuthRequired, onAuthConfirmed, listener } = renderWithAuth()
      act(() => listener({ processed: 2, stoppedReason: 'empty' }))
      expect(onAuthConfirmed).toHaveBeenCalledTimes(1)
      expect(onAuthRequired).not.toHaveBeenCalled()
    })

    it('does not call either auth callback when a drain found nothing to do or was aborted', () => {
      const { onAuthRequired, onAuthConfirmed, listener } = renderWithAuth()
      act(() => listener({ processed: 0, stoppedReason: 'empty' }))
      act(() => listener({ processed: 0, stoppedReason: 'aborted' }))
      expect(onAuthRequired).not.toHaveBeenCalled()
      expect(onAuthConfirmed).not.toHaveBeenCalled()
    })
  })
})

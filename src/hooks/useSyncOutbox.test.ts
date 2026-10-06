import { act, renderHook } from '@testing-library/react'
import { useSyncOutbox } from './useSyncOutbox.ts'
import { drainOutbox, startAutoSync, subscribeToDrains } from '../lib/sync/outboxRunner.ts'
import { queueAttachmentUpload, queueEntryCreate, queueEntryCreates, queueEntryDeletion } from '../lib/sync/outboxQueue.ts'
import type { Entry } from '../types/entry.ts'

jest.mock('../lib/sync/outboxRunner.ts', () => ({
  drainOutbox: jest.fn().mockResolvedValue({ processed: 0, stoppedReason: 'empty' }),
  startAutoSync: jest.fn().mockReturnValue(jest.fn()),
  subscribeToDrains: jest.fn().mockReturnValue(jest.fn()),
}))
jest.mock('../lib/sync/outboxQueue.ts', () => ({
  queueAttachmentUpload: jest.fn().mockResolvedValue(undefined),
  queueEntryCreate: jest.fn().mockResolvedValue(undefined),
  queueEntryCreates: jest.fn().mockResolvedValue(undefined),
  queueEntryDeletion: jest.fn().mockResolvedValue(undefined),
}))

const drainMock = drainOutbox as jest.Mock
const startAutoSyncMock = startAutoSync as jest.Mock
const subscribeMock = subscribeToDrains as jest.Mock
const queueAttachmentUploadMock = queueAttachmentUpload as jest.Mock
const queueEntryCreateMock = queueEntryCreate as jest.Mock
const queueEntryCreatesMock = queueEntryCreates as jest.Mock
const queueEntryDeletionMock = queueEntryDeletion as jest.Mock

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
  queueEntryDeletionMock.mockResolvedValue(undefined)
})

describe('useSyncOutbox sync status when the server has login off', () => {
  it('says sync is off', () => {
    const { result } = renderHook(() => useSyncOutbox({ syncOff: true }))
    expect(result.current.syncStatus).toBe('Saved locally · sync is off')
  })
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

  it('queueEntryWithPhotos queues the create, then each photo, then drains', async () => {
    const { result } = renderHook(() => useSyncOutbox())
    drainMock.mockClear()
    const a = new File(['a'], 'a.jpg', { type: 'image/jpeg' })
    const b = new File(['b'], 'b.jpg', { type: 'image/jpeg' })

    await act(async () => {
      result.current.queueEntryWithPhotos(makeEntry(1), [a, b])
    })

    expect(queueEntryCreateMock).toHaveBeenCalledWith(makeEntry(1))
    expect(queueAttachmentUploadMock).toHaveBeenNthCalledWith(1, makeEntry(1), a, 'a.jpg')
    expect(queueAttachmentUploadMock).toHaveBeenNthCalledWith(2, makeEntry(1), b, 'b.jpg')
    expect(drainMock).toHaveBeenCalled()
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

  it('queueEntryDeletion queues the deletion and kicks a drain', async () => {
    const { result } = renderHook(() => useSyncOutbox())
    drainMock.mockClear()

    await act(async () => {
      result.current.queueEntryDeletion(4)
    })

    expect(queueEntryDeletionMock).toHaveBeenCalledWith(4)
    expect(drainMock).toHaveBeenCalled()
  })

  describe('auth reporting', () => {
    function renderWithAuth() {
      const onAuthRequired = jest.fn()
      renderHook(() => useSyncOutbox({ onAuthRequired }))
      const listener = subscribeMock.mock.calls[0][0]
      return { onAuthRequired, listener }
    }

    it('calls onAuthRequired with the status when any drain finds the session is gone, wherever it started', () => {
      const { onAuthRequired, listener } = renderWithAuth()
      act(() => listener({ processed: 0, stoppedReason: 'auth', error: 'Authentication required.', authStatus: 401 }))
      expect(onAuthRequired).toHaveBeenCalledTimes(1)
      expect(onAuthRequired).toHaveBeenCalledWith(401)
    })

    it('passes a 403 through as such, so the caller can tell it from an expired session', () => {
      const { onAuthRequired, listener } = renderWithAuth()
      act(() => listener({ processed: 0, stoppedReason: 'auth', authStatus: 403 }))
      expect(onAuthRequired).toHaveBeenCalledWith(403)
    })

    it('does not call it when a drain succeeded, found nothing to do or was aborted', () => {
      const { onAuthRequired, listener } = renderWithAuth()
      act(() => listener({ processed: 2, stoppedReason: 'empty' }))
      act(() => listener({ processed: 0, stoppedReason: 'empty' }))
      act(() => listener({ processed: 0, stoppedReason: 'aborted' }))
      expect(onAuthRequired).not.toHaveBeenCalled()
    })
  })
})

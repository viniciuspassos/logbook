import { act, renderHook } from '@testing-library/react'
import { useSyncOutbox } from './useSyncOutbox.ts'
import { drainOutbox, startAutoSync } from '../lib/sync/outboxRunner.ts'
import { queueEntryCreate } from '../lib/sync/outboxQueue.ts'
import type { Entry } from '../types/entry.ts'

jest.mock('../lib/sync/outboxRunner.ts', () => ({
  drainOutbox: jest.fn().mockResolvedValue({ processed: 0, stoppedReason: 'empty' }),
  startAutoSync: jest.fn().mockReturnValue(jest.fn()),
}))
jest.mock('../lib/sync/outboxQueue.ts', () => ({
  queueEntryCreate: jest.fn().mockResolvedValue(undefined),
}))

const drainMock = drainOutbox as jest.Mock
const startAutoSyncMock = startAutoSync as jest.Mock
const queueEntryCreateMock = queueEntryCreate as jest.Mock

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
  queueEntryCreateMock.mockResolvedValue(undefined)
})

describe('useSyncOutbox', () => {
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
    it('calls onAuthRequired when the mount-time drain finds the session is gone', async () => {
      drainMock.mockResolvedValue({ processed: 0, stoppedReason: 'auth', error: 'Authentication required.' })
      const onAuthRequired = jest.fn()

      await act(async () => {
        renderHook(() => useSyncOutbox({ onAuthRequired }))
      })

      expect(onAuthRequired).toHaveBeenCalledTimes(1)
    })

    it('calls onAuthConfirmed when the mount-time drain actually processed something', async () => {
      drainMock.mockResolvedValue({ processed: 2, stoppedReason: 'empty' })
      const onAuthConfirmed = jest.fn()

      await act(async () => {
        renderHook(() => useSyncOutbox({ onAuthConfirmed }))
      })

      expect(onAuthConfirmed).toHaveBeenCalledTimes(1)
    })

    it('does not call either auth callback when the drain simply found nothing to do', async () => {
      drainMock.mockResolvedValue({ processed: 0, stoppedReason: 'empty' })
      const onAuthRequired = jest.fn()
      const onAuthConfirmed = jest.fn()

      await act(async () => {
        renderHook(() => useSyncOutbox({ onAuthRequired, onAuthConfirmed }))
      })

      expect(onAuthRequired).not.toHaveBeenCalled()
      expect(onAuthConfirmed).not.toHaveBeenCalled()
    })

    it('reports an auth failure discovered by queueEntryCreate\'s own drain', async () => {
      const onAuthRequired = jest.fn()
      const { result } = renderHook(() => useSyncOutbox({ onAuthRequired }))
      drainMock.mockResolvedValue({ processed: 0, stoppedReason: 'auth', error: 'Authentication required.' })

      await act(async () => {
        result.current.queueEntryCreate(makeEntry(1))
      })

      expect(onAuthRequired).toHaveBeenCalledTimes(1)
    })
  })
})

import { act, renderHook } from '@testing-library/react'
import { useLogbookApp } from './useLogbookApp.ts'

describe('useLogbookApp', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('starts on the timeline tab with no overlay', () => {
    const { result } = renderHook(() => useLogbookApp())
    expect(result.current.tab).toBe('timeline')
    expect(result.current.overlay).toBeNull()
    expect(result.current.timelineView).toBe('list')
  })

  it('goTab switches tabs and closes any open overlay', () => {
    const { result } = renderHook(() => useLogbookApp())
    act(() => result.current.openEntry(2))
    expect(result.current.overlay).toBe('entry')

    act(() => result.current.goTab('stats'))
    expect(result.current.tab).toBe('stats')
    expect(result.current.overlay).toBeNull()
  })

  it('openEntry selects the entry and resets raw notes visibility', () => {
    const { result } = renderHook(() => useLogbookApp())
    act(() => result.current.toggleRaw())
    act(() => result.current.openEntry(3))

    expect(result.current.overlay).toBe('entry')
    expect(result.current.selectedEntry.id).toBe(3)
    expect(result.current.rawOpen).toBe(false)
  })

  it('falls back to the first entry when no entry is selected yet', () => {
    const { result } = renderHook(() => useLogbookApp())
    expect(result.current.selectedEntry.id).toBe(1)
  })

  it('toggleRaw flips raw notes visibility', () => {
    const { result } = renderHook(() => useLogbookApp())
    act(() => result.current.toggleRaw())
    expect(result.current.rawOpen).toBe(true)
    act(() => result.current.toggleRaw())
    expect(result.current.rawOpen).toBe(false)
  })

  it('startRecording walks capture -> listening -> processing -> review on a timer', () => {
    const { result } = renderHook(() => useLogbookApp())
    act(() => result.current.openNewEntry())
    expect(result.current.newStep).toBe('capture')

    act(() => result.current.startRecording())
    expect(result.current.newStep).toBe('listening')

    act(() => {
      jest.advanceTimersByTime(1400)
    })
    expect(result.current.newStep).toBe('processing')

    act(() => {
      jest.advanceTimersByTime(1400)
    })
    expect(result.current.newStep).toBe('review')
  })

  it('saveEntry closes the overlay and returns to the timeline tab', () => {
    const { result } = renderHook(() => useLogbookApp())
    act(() => result.current.goTab('settings'))
    act(() => result.current.openNewEntry())

    act(() => result.current.saveEntry())
    expect(result.current.overlay).toBeNull()
    expect(result.current.tab).toBe('timeline')
    expect(result.current.newStep).toBe('capture')
  })

  it('clears pending timers on unmount without throwing', () => {
    const { result, unmount } = renderHook(() => useLogbookApp())
    act(() => result.current.startRecording())
    expect(() => unmount()).not.toThrow()
  })
})

import { act, renderHook } from '@testing-library/react'
import { useNavigation } from './useNavigation.ts'
import type { Entry } from '../types/entry.ts'

/**
 * Direct coverage of useNavigation's own exported behavior. Previously this
 * hook only got 100% function coverage indirectly through
 * useLogbookApp.test.ts exercising it as a side effect of the composition
 * root — this file gives it its own regression signal so a future reshape of
 * useLogbookApp can't silently drop it.
 */

function makeEntry(overrides: Partial<Entry> & { id: number }): Entry {
  return {
    title: `Entry ${overrides.id}`,
    shape: 'triangle',
    location: 'Somewhere',
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
    ...overrides,
  }
}

const entries = [makeEntry({ id: 1 }), makeEntry({ id: 2, title: 'Second' })]

describe('useNavigation', () => {
  it('starts on the timeline tab with no overlay, raw notes closed, and list view', () => {
    const { result } = renderHook(() => useNavigation(entries))
    expect(result.current.tab).toBe('timeline')
    expect(result.current.overlay).toBeNull()
    expect(result.current.rawOpen).toBe(false)
    expect(result.current.timelineView).toBe('list')
    expect(result.current.selectedEntry).toBeNull()
  })

  it('goTab switches the active tab and closes any open overlay', () => {
    const { result } = renderHook(() => useNavigation(entries))
    act(() => result.current.openNewEntryOverlay())
    expect(result.current.overlay).toBe('newEntry')

    act(() => result.current.goTab('stats'))
    expect(result.current.tab).toBe('stats')
    expect(result.current.overlay).toBeNull()
  })

  it('openEntry opens the entry overlay, selects the id, and resets raw notes visibility', () => {
    const { result } = renderHook(() => useNavigation(entries))
    act(() => result.current.toggleRaw())
    expect(result.current.rawOpen).toBe(true)

    act(() => result.current.openEntry(2))
    expect(result.current.overlay).toBe('entry')
    expect(result.current.selectedEntry).toEqual(entries[1])
    expect(result.current.rawOpen).toBe(false)
  })

  it('closeOverlay clears the open overlay', () => {
    const { result } = renderHook(() => useNavigation(entries))
    act(() => result.current.openEntry(1))
    expect(result.current.overlay).toBe('entry')

    act(() => result.current.closeOverlay())
    expect(result.current.overlay).toBeNull()
  })

  it('toggleRaw flips raw notes visibility', () => {
    const { result } = renderHook(() => useNavigation(entries))
    act(() => result.current.toggleRaw())
    expect(result.current.rawOpen).toBe(true)
    act(() => result.current.toggleRaw())
    expect(result.current.rawOpen).toBe(false)
  })

  it('openNewEntryOverlay opens the new-entry overlay', () => {
    const { result } = renderHook(() => useNavigation(entries))
    act(() => result.current.openNewEntryOverlay())
    expect(result.current.overlay).toBe('newEntry')
  })

  it('goTimeline switches to the timeline tab and closes any open overlay', () => {
    const { result } = renderHook(() => useNavigation(entries))
    act(() => result.current.goTab('settings'))
    act(() => result.current.openEntry(1))
    expect(result.current.overlay).toBe('entry')

    act(() => result.current.goTimeline())
    expect(result.current.tab).toBe('timeline')
    expect(result.current.overlay).toBeNull()
  })

  it('setTimelineView switches between list and map', () => {
    const { result } = renderHook(() => useNavigation(entries))
    act(() => result.current.setTimelineView('map'))
    expect(result.current.timelineView).toBe('map')
    act(() => result.current.setTimelineView('list'))
    expect(result.current.timelineView).toBe('list')
  })

  it('selectedEntry is explicitly null for an unknown id rather than falling back to the first entry', () => {
    const { result } = renderHook(() => useNavigation(entries))
    act(() => result.current.openEntry(999))
    expect(result.current.selectedEntry).toBeNull()
  })
})

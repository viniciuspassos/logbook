import { act, renderHook } from '@testing-library/react'
import { useLogbookApp } from './useLogbookApp.ts'
import { extractEntry } from '../lib/ai/extractEntry.ts'
import { rewriteStory } from '../lib/ai/rewriteStory.ts'

const extractMock = extractEntry as jest.Mock
const rewriteMock = rewriteStory as jest.Mock

// Orchestration-only tests: the speech and AI wrappers are mocked so these
// focus on state transitions, not on the real (browser-only) APIs.

let capturedOnEnd: ((finalTranscript: string) => void) | undefined

jest.mock('./useSpeechCapture.ts', () => ({
  useSpeechCapture: (opts?: { onEnd?: (t: string) => void }) => {
    capturedOnEnd = opts?.onEnd
    return {
      supported: true,
      listening: false,
      transcript: '',
      interimTranscript: '',
      error: null,
      start: jest.fn(),
      stop: jest.fn(),
      abort: jest.fn(),
    }
  },
}))

jest.mock('../lib/ai/availability.ts', () => ({
  getAiCapabilities: jest
    .fn()
    .mockResolvedValue({ speech: true, prompt: 'available', rewriter: 'available' }),
  getRewriterAvailability: jest.fn().mockResolvedValue('available'),
  isCapabilityUsable: (c: string) => c !== 'unavailable',
}))

jest.mock('../lib/ai/extractEntry.ts', () => ({
  extractEntry: jest.fn().mockResolvedValue({
    title: 'Summit day',
    activityType: 'Climbing',
    shape: 'triangle',
    location: 'Alps',
    weather: 'Clear',
    duration: '6h',
    difficulty: 'Moderate',
    equipment: 'Ropes',
    participants: 'Solo',
    metric: '3000m',
  }),
}))

jest.mock('../lib/ai/rewriteStory.ts', () => ({
  rewriteStory: jest.fn().mockResolvedValue('A polished story.'),
  deriveExcerpt: (story: string) => story,
}))

function triggerSpeechEnd(transcript: string) {
  capturedOnEnd?.(transcript)
}

describe('useLogbookApp', () => {
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
    expect(result.current.selectedEntry?.id).toBe(3)
    expect(result.current.rawOpen).toBe(false)
  })

  it('has no selected entry until one is opened (no silent fallback)', () => {
    // Replaces the former "falls back to the first entry" test: per the plan's
    // Phase 0 #6, an unknown/absent selection is now explicitly null rather
    // than silently masquerading as entries[0].
    const { result } = renderHook(() => useLogbookApp())
    expect(result.current.selectedEntry).toBeNull()
  })

  it('toggleRaw flips raw notes visibility', () => {
    const { result } = renderHook(() => useLogbookApp())
    act(() => result.current.toggleRaw())
    expect(result.current.rawOpen).toBe(true)
    act(() => result.current.toggleRaw())
    expect(result.current.rawOpen).toBe(false)
  })

  it('walks capture -> listening -> review via speech and AI', async () => {
    const { result } = renderHook(() => useLogbookApp())
    act(() => result.current.openNewEntry())
    expect(result.current.newStep).toBe('capture')

    act(() => result.current.startRecording())
    expect(result.current.newStep).toBe('listening')

    await act(async () => {
      triggerSpeechEnd('climbed a peak in the alps today')
    })
    expect(result.current.newStep).toBe('review')
    expect(result.current.draft.extracted?.title).toBe('Summit day')
    expect(result.current.draft.story).toBe('A polished story.')
  })

  it('submitTyped processes typed text straight to review', async () => {
    const { result } = renderHook(() => useLogbookApp())
    act(() => result.current.openNewEntry())

    await act(async () => {
      result.current.submitTyped('a quick hike near home')
    })
    expect(result.current.newStep).toBe('review')
    expect(result.current.draft.raw).toBe('a quick hike near home')
  })

  it('saveEntry prepends the built entry and returns to the timeline', async () => {
    const { result } = renderHook(() => useLogbookApp())
    const initialCount = result.current.entries.length

    act(() => result.current.goTab('settings'))
    act(() => result.current.openNewEntry())
    await act(async () => {
      triggerSpeechEnd('climbed a peak today')
    })

    act(() => result.current.saveEntry())
    expect(result.current.entries).toHaveLength(initialCount + 1)
    expect(result.current.entries[0].title).toBe('Summit day')
    expect(result.current.overlay).toBeNull()
    expect(result.current.tab).toBe('timeline')
    expect(result.current.newStep).toBe('capture')
  })

  it('aborts in-flight processing on close and never advances to review', async () => {
    let resolveExtract: ((value: unknown) => void) | undefined
    extractMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveExtract = resolve
        }),
    )
    const { result } = renderHook(() => useLogbookApp())
    act(() => result.current.openNewEntry())

    await act(async () => {
      result.current.submitTyped('a long dictated note')
    })
    expect(result.current.newStep).toBe('processing')

    act(() => result.current.closeOverlay())
    expect(result.current.overlay).toBeNull()

    // Resolving after the abort must not push the flow to review.
    await act(async () => {
      resolveExtract?.({
        title: 'Late',
        activityType: 'Hiking',
        shape: 'diamond',
        location: '',
        weather: '',
        duration: '',
        difficulty: '',
        equipment: '',
        participants: '',
        metric: '',
      })
    })
    expect(result.current.newStep).toBe('processing')
  })

  it('regenerateStory swaps in a fresh rewrite', async () => {
    const { result } = renderHook(() => useLogbookApp())
    act(() => result.current.openNewEntry())
    await act(async () => {
      triggerSpeechEnd('climbed a peak today')
    })
    expect(result.current.draft.story).toBe('A polished story.')

    rewriteMock.mockResolvedValueOnce('A different story.')
    await act(async () => {
      await result.current.regenerateStory()
    })
    expect(result.current.draft.story).toBe('A different story.')
  })

  it('editStory updates the draft story text', async () => {
    const { result } = renderHook(() => useLogbookApp())
    act(() => result.current.openNewEntry())
    await act(async () => {
      triggerSpeechEnd('a note')
    })
    act(() => result.current.editStory('my hand-written story'))
    expect(result.current.draft.story).toBe('my hand-written story')
  })

  it('closeOverlay aborts an in-flight flow without throwing', () => {
    const { result } = renderHook(() => useLogbookApp())
    act(() => result.current.openNewEntry())
    act(() => result.current.startRecording())
    expect(() => act(() => result.current.closeOverlay())).not.toThrow()
    expect(result.current.overlay).toBeNull()
  })

  it('unmounts cleanly while capturing', () => {
    const { result, unmount } = renderHook(() => useLogbookApp())
    act(() => result.current.openNewEntry())
    act(() => result.current.startRecording())
    expect(() => unmount()).not.toThrow()
  })
})

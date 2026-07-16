import { act, renderHook } from '@testing-library/react'
import { useSpeechCapture } from './useSpeechCapture.ts'

class MockSpeechRecognition extends EventTarget {
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 1
  onresult: ((event: SpeechRecognitionEvent) => void) | null = null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null
  onend: ((event: Event) => void) | null = null
  onstart: ((event: Event) => void) | null = null
  start = jest.fn()
  stop = jest.fn(() => this.onend?.(new Event('end')))
  abort = jest.fn()

  emitResult(chunks: Array<{ transcript: string; isFinal: boolean }>) {
    const results = chunks.map((c) => {
      const alt = { transcript: c.transcript, confidence: 1 }
      return { 0: alt, isFinal: c.isFinal, length: 1, item: () => alt }
    })
    const list: Record<string, unknown> = {
      length: results.length,
      item: (i: number) => results[i],
    }
    results.forEach((result, index) => {
      list[index] = result
    })
    this.onresult?.({
      resultIndex: 0,
      results: list as unknown as SpeechRecognitionResultList,
    } as unknown as SpeechRecognitionEvent)
  }

  emitError(code: SpeechRecognitionErrorCode) {
    this.onerror?.({ error: code, message: '' } as SpeechRecognitionErrorEvent)
  }
}

let instances: MockSpeechRecognition[] = []

beforeEach(() => {
  instances = []
  window.SpeechRecognition = class extends MockSpeechRecognition {
    constructor() {
      super()
      instances.push(this)
    }
  }
})

afterEach(() => {
  delete window.SpeechRecognition
})

function latest() {
  return instances[instances.length - 1]
}

describe('useSpeechCapture', () => {
  it('reports supported when a recognizer global exists', () => {
    const { result } = renderHook(() => useSpeechCapture())
    expect(result.current.supported).toBe(true)
  })

  it('accumulates final transcript and mirrors interim results', () => {
    const { result } = renderHook(() => useSpeechCapture())
    act(() => result.current.start())
    expect(result.current.listening).toBe(true)

    act(() => latest().emitResult([{ transcript: 'hello ', isFinal: true }]))
    act(() => latest().emitResult([{ transcript: 'world', isFinal: false }]))

    expect(result.current.transcript).toBe('hello ')
    expect(result.current.interimTranscript).toBe('world')
  })

  it('fires onEnd with the final transcript on stop', () => {
    const onEnd = jest.fn()
    const { result } = renderHook(() => useSpeechCapture({ onEnd }))
    act(() => result.current.start())
    act(() => latest().emitResult([{ transcript: 'summit day', isFinal: true }]))
    act(() => result.current.stop())

    expect(onEnd).toHaveBeenCalledWith('summit day')
    expect(result.current.listening).toBe(false)
  })

  it('maps a permission error and does not fire onEnd on abort', () => {
    const onEnd = jest.fn()
    const { result } = renderHook(() => useSpeechCapture({ onEnd }))
    act(() => result.current.start())
    act(() => latest().emitError('not-allowed'))
    expect(result.current.error).toBe('permission-denied')

    act(() => latest().emitError('aborted'))
    act(() => latest().onend?.(new Event('end')))
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('abort() discards the capture and suppresses onEnd', () => {
    const onEnd = jest.fn()
    const { result } = renderHook(() => useSpeechCapture({ onEnd }))
    act(() => result.current.start())
    act(() => latest().emitResult([{ transcript: 'discard me', isFinal: true }]))
    act(() => result.current.abort())
    // Recognizers fire onend after abort(); onEnd must not run.
    act(() => latest().onend?.(new Event('end')))
    expect(onEnd).not.toHaveBeenCalled()
    expect(latest().abort).toHaveBeenCalledTimes(1)
  })

  it('aborts an active recognizer on unmount', () => {
    const { result, unmount } = renderHook(() => useSpeechCapture())
    act(() => result.current.start())
    const recognizer = latest()
    unmount()
    expect(recognizer.abort).toHaveBeenCalledTimes(1)
  })

  it('reports unsupported when no recognizer global exists', () => {
    delete window.SpeechRecognition
    const onEnd = jest.fn()
    const { result } = renderHook(() => useSpeechCapture({ onEnd }))
    expect(result.current.supported).toBe(false)
    act(() => result.current.start())
    expect(result.current.error).toBe('unsupported')
  })
})

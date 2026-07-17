import { act, renderHook } from '@testing-library/react'
import { useNewEntryFlow } from './useNewEntryFlow.ts'
import type { SpeechCaptureError } from './useSpeechCapture.ts'

/**
 * useNewEntryFlow.ts's happy paths (capture -> listening -> review via
 * speech/typed text, regenerate, save) are already exercised indirectly
 * through useLogbookApp.test.ts. This file covers the hook in isolation for
 * its speech-capture edge cases — the "no speech detected" / unsupported /
 * mic-error paths, and the plain `stopRecording` delegation — none of which
 * useLogbookApp's stub for useSpeechCapture (start/stop/abort as bare no-ops,
 * no onError hookup) ever reaches.
 */

let capturedOnEnd: ((transcript: string) => void) | undefined
let capturedOnError: ((error: SpeechCaptureError) => void) | undefined
let mockSupported = true
const mockStart = jest.fn()
const mockStop = jest.fn()
const mockAbort = jest.fn()

jest.mock('./useSpeechCapture.ts', () => ({
  useSpeechCapture: (opts?: {
    onEnd?: (transcript: string) => void
    onError?: (error: SpeechCaptureError) => void
  }) => {
    capturedOnEnd = opts?.onEnd
    capturedOnError = opts?.onError
    return {
      supported: mockSupported,
      listening: false,
      transcript: '',
      interimTranscript: '',
      error: null,
      start: mockStart,
      stop: mockStop,
      abort: mockAbort,
    }
  },
}))

beforeEach(() => {
  mockSupported = true
  jest.clearAllMocks()
})

describe('useNewEntryFlow', () => {
  it('stopRecording delegates to the underlying speech capture', () => {
    const { result } = renderHook(() => useNewEntryFlow())
    act(() => result.current.stopRecording())
    expect(mockStop).toHaveBeenCalledTimes(1)
  })

  it('returns to capture with a fallback message when speech ends with no transcript', () => {
    const { result } = renderHook(() => useNewEntryFlow())

    act(() => capturedOnEnd?.(''))

    expect(result.current.step).toBe('capture')
    expect(result.current.captureError).toBe(
      'No speech detected. Try again or type your note instead.',
    )
  })

  it('preserves an existing capture error rather than overwriting it on an empty transcript', () => {
    const { result } = renderHook(() => useNewEntryFlow())
    act(() => capturedOnError?.('permission-denied'))
    expect(result.current.captureError).toBe(
      'Microphone access was blocked. Enable it or type your note instead.',
    )

    act(() => capturedOnEnd?.(''))

    // The `prev ?? fallback` updater must not clobber a message that's
    // already on screen with the generic no-speech one.
    expect(result.current.captureError).toBe(
      'Microphone access was blocked. Enable it or type your note instead.',
    )
  })

  it('surfaces a user-facing message and resets to capture on a speech-recognition error', () => {
    const { result } = renderHook(() => useNewEntryFlow())

    act(() => capturedOnError?.('permission-denied'))

    expect(result.current.step).toBe('capture')
    expect(result.current.captureError).toBe(
      'Microphone access was blocked. Enable it or type your note instead.',
    )
  })

  it('does not start recording when speech capture is unsupported', () => {
    mockSupported = false
    const { result } = renderHook(() => useNewEntryFlow())

    act(() => result.current.startRecording())

    expect(mockStart).not.toHaveBeenCalled()
    expect(result.current.step).toBe('capture')
    expect(result.current.captureError).toBe(
      "Voice input isn't available in this browser. Type your note instead.",
    )
  })
})

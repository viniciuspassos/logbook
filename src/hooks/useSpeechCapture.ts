import { useCallback, useEffect, useRef, useState } from 'react'
import { isSpeechRecognitionSupported } from '../lib/ai/availability.ts'

export type SpeechCaptureError =
  | 'permission-denied'
  | 'no-speech'
  | 'network'
  | 'aborted'
  | 'unsupported'
  | 'unknown'

export interface UseSpeechCapture {
  supported: boolean
  listening: boolean
  transcript: string
  interimTranscript: string
  error: SpeechCaptureError | null
  start: () => void
  /** Graceful stop: flushes the final result and fires `onEnd`. */
  stop: () => void
  /** Immediate stop: discards the capture and suppresses `onEnd`. */
  abort: () => void
}

interface Options {
  lang?: string
  /** Fires once when recognition ends, with the accumulated final transcript. */
  onEnd?: (finalTranscript: string) => void
  /** Fires when recognition errors (never for an intentional abort). */
  onError?: (error: SpeechCaptureError) => void
}

function mapError(code: SpeechRecognitionErrorCode): SpeechCaptureError {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'permission-denied'
    case 'no-speech':
      return 'no-speech'
    case 'network':
      return 'network'
    case 'aborted':
      return 'aborted'
    default:
      return 'unknown'
  }
}

/**
 * Thin React wrapper over the Web Speech API's `SpeechRecognition`. The
 * recognizer is constructed on `start()` (not on mount) so the mic-permission
 * prompt only appears after a user gesture. `onEnd` is read through a ref to
 * dodge stale closures, matching how event-driven APIs are consumed elsewhere.
 */
export function useSpeechCapture(options?: Options): UseSpeechCapture {
  const supported = isSpeechRecognitionSupported()
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [error, setError] = useState<SpeechCaptureError | null>(null)

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const finalRef = useRef('')
  const errorRef = useRef<SpeechCaptureError | null>(null)
  const onEndRef = useRef(options?.onEnd)
  const onErrorRef = useRef(options?.onError)
  const lang = options?.lang ?? 'en-US'

  // Keep the latest callbacks in refs so the event handlers below never read a
  // stale closure. Synced in an effect (not during render) per the hooks rules.
  useEffect(() => {
    onEndRef.current = options?.onEnd
    onErrorRef.current = options?.onError
  })

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const abort = useCallback(() => {
    const recognition = recognitionRef.current
    if (recognition) {
      // Mark as aborted so `onend` suppresses the onEnd callback (the capture
      // is being discarded, e.g. the overlay was cancelled).
      errorRef.current = 'aborted'
      recognition.abort()
    }
  }, [])

  const start = useCallback(() => {
    if (!supported) {
      setError('unsupported')
      return
    }
    // Reset accumulators for a fresh capture.
    finalRef.current = ''
    errorRef.current = null
    setTranscript('')
    setInterimTranscript('')
    setError(null)

    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!Ctor) {
      setError('unsupported')
      return
    }
    const recognition = new Ctor()
    recognition.lang = lang
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const text = result[0].transcript
        if (result.isFinal) {
          finalRef.current += text
        } else {
          interim += text
        }
      }
      setTranscript(finalRef.current)
      setInterimTranscript(interim)
    }

    recognition.onerror = (event) => {
      const mapped = mapError(event.error)
      errorRef.current = mapped
      setError(mapped)
      if (mapped !== 'aborted') onErrorRef.current?.(mapped)
    }

    recognition.onend = () => {
      setListening(false)
      setInterimTranscript('')
      recognitionRef.current = null
      // Suppress the callback on an aborted teardown (overlay close / unmount).
      if (errorRef.current !== 'aborted') {
        onEndRef.current?.(finalRef.current.trim())
      }
    }

    recognitionRef.current = recognition
    setListening(true)
    recognition.start()
  }, [lang, supported])

  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current
      if (recognition) {
        errorRef.current = 'aborted'
        recognition.abort()
        recognitionRef.current = null
      }
    }
  }, [])

  return { supported, listening, transcript, interimTranscript, error, start, stop, abort }
}

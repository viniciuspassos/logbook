import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getAiCapabilities,
  getRewriterAvailability,
  isCapabilityUsable,
} from '../lib/ai/availability.ts'
import { extractEntry } from '../lib/ai/extractEntry.ts'
import { rewriteStory } from '../lib/ai/rewriteStory.ts'
import type { Draft } from '../lib/buildEntry.ts'
import { useSpeechCapture, type SpeechCaptureError } from './useSpeechCapture.ts'

export type NewEntryStep = 'capture' | 'listening' | 'processing' | 'review'

const EMPTY_DRAFT: Draft = { raw: '', extracted: null, story: '' }

function speechErrorMessage(error: SpeechCaptureError): string {
  switch (error) {
    case 'permission-denied':
      return 'Microphone access was blocked. Enable it or type your note instead.'
    case 'no-speech':
      return 'No speech detected. Try again or type your note instead.'
    case 'network':
      return 'Speech recognition needs a network connection. Type your note instead.'
    case 'unsupported':
      return "Voice input isn't available in this browser. Type your note instead."
    default:
      return 'Something went wrong capturing audio. Try again or type your note instead.'
  }
}

/**
 * The new-entry capture → AI-processing → review flow. Orchestrates speech
 * capture, on-device extraction, and story rewriting, with graceful fallbacks
 * so AI unavailability never blocks entry creation.
 */
export function useNewEntryFlow() {
  const [step, setStep] = useState<NewEntryStep>('capture')
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [isRegenerating, setIsRegenerating] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const variantRef = useRef(0)
  const mountedRef = useRef(true)
  const draftRef = useRef(draft)

  // Sync the latest draft into a ref (outside render) so regenerateStory can
  // read it without being re-created on every keystroke.
  useEffect(() => {
    draftRef.current = draft
  })

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  const beginProcessing = useCallback((): AbortSignal => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    return controller.signal
  }, [])

  const processRaw = useCallback(
    async (rawText: string) => {
      setCaptureError(null)
      setStep('processing')
      const signal = beginProcessing()

      const caps = await getAiCapabilities()
      if (signal.aborted || !mountedRef.current) return

      // Sequential, not parallel: Gemini Nano is a single on-device model, so
      // two concurrent sessions can contend on low-end hardware.
      let extracted = null
      if (isCapabilityUsable(caps.prompt)) {
        try {
          extracted = await extractEntry(rawText, { signal })
        } catch {
          extracted = null
        }
      }
      if (signal.aborted || !mountedRef.current) return

      let story = rawText
      if (isCapabilityUsable(caps.rewriter)) {
        try {
          story = await rewriteStory(rawText, { signal })
        } catch {
          story = rawText
        }
      }
      if (signal.aborted || !mountedRef.current) return

      variantRef.current = 0
      setDraft({ raw: rawText, extracted, story })
      setStep('review')
    },
    [beginProcessing],
  )

  const handleSpeechEnd = useCallback(
    (finalTranscript: string) => {
      if (!finalTranscript) {
        setStep('capture')
        setCaptureError(
          (prev) => prev ?? 'No speech detected. Try again or type your note instead.',
        )
        return
      }
      void processRaw(finalTranscript)
    },
    [processRaw],
  )

  const handleSpeechError = useCallback((error: SpeechCaptureError) => {
    setCaptureError(speechErrorMessage(error))
    setStep('capture')
  }, [])

  const speech = useSpeechCapture({ onEnd: handleSpeechEnd, onError: handleSpeechError })

  const startRecording = useCallback(() => {
    setCaptureError(null)
    if (!speech.supported) {
      setCaptureError(speechErrorMessage('unsupported'))
      return
    }
    setStep('listening')
    speech.start()
  }, [speech])

  const stopRecording = useCallback(() => {
    // Graceful stop: the final transcript flows through onEnd -> processRaw.
    speech.stop()
  }, [speech])

  const submitTyped = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      void processRaw(trimmed)
    },
    [processRaw],
  )

  const regenerateStory = useCallback(async () => {
    const current = draftRef.current
    if (!current.raw) return
    const signal = beginProcessing()
    setIsRegenerating(true)
    variantRef.current += 1
    try {
      const availability = await getRewriterAvailability()
      if (!isCapabilityUsable(availability)) return
      const story = await rewriteStory(current.raw, {
        variant: variantRef.current,
        signal,
      })
      if (signal.aborted || !mountedRef.current) return
      setDraft((prev) => ({ ...prev, story }))
    } catch {
      // Keep the existing story on failure.
    } finally {
      if (mountedRef.current) setIsRegenerating(false)
    }
  }, [beginProcessing])

  const editStory = useCallback((text: string) => {
    setDraft((prev) => ({ ...prev, story: text }))
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    speech.abort()
    variantRef.current = 0
    setStep('capture')
    setDraft(EMPTY_DRAFT)
    setCaptureError(null)
    setIsRegenerating(false)
  }, [speech])

  const abort = useCallback(() => {
    // Discard, don't flush: cancelling must not trigger a wasted extraction.
    abortRef.current?.abort()
    speech.abort()
  }, [speech])

  return {
    step,
    draft,
    captureError,
    isRegenerating,
    listening: speech.listening,
    transcript: speech.transcript,
    interimTranscript: speech.interimTranscript,
    startRecording,
    stopRecording,
    submitTyped,
    regenerateStory,
    editStory,
    reset,
    abort,
  }
}

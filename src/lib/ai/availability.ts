export type AiCapability = AiAvailability

/**
 * Whether the built-in Prompt API (LanguageModel) can be used. Safe to call in
 * any environment: returns `'unavailable'` when the global is absent (e.g.
 * jsdom, or Chrome without the flag enabled) rather than throwing.
 */
export async function getLanguageModelAvailability(): Promise<AiCapability> {
  if (typeof LanguageModel === 'undefined') return 'unavailable'
  try {
    return await LanguageModel.availability()
  } catch {
    return 'unavailable'
  }
}

/** Whether the built-in Rewriter API can be used. See {@link getLanguageModelAvailability}. */
export async function getRewriterAvailability(
  options?: RewriterCreateOptions,
): Promise<AiCapability> {
  if (typeof Rewriter === 'undefined') return 'unavailable'
  try {
    return await Rewriter.availability(options)
  } catch {
    return 'unavailable'
  }
}

/** Whether the Web Speech API's SpeechRecognition (or webkit prefix) exists. */
export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
}

export interface AiCapabilities {
  speech: boolean
  prompt: AiCapability
  rewriter: AiCapability
}

/** Snapshot of every on-device capability Logbook depends on, in one call. */
export async function getAiCapabilities(): Promise<AiCapabilities> {
  const [prompt, rewriter] = await Promise.all([
    getLanguageModelAvailability(),
    getRewriterAvailability(),
  ])
  return { speech: isSpeechRecognitionSupported(), prompt, rewriter }
}

/**
 * A capability is usable if the model is ready or will download on first
 * `create()`. `'downloadable'`/`'downloading'` are treated as usable — Chrome
 * kicks off the download transparently; progress UI is a future enhancement.
 */
export function isCapabilityUsable(capability: AiCapability): boolean {
  return capability !== 'unavailable'
}

export type AiProcessingStatus = 'enabled' | 'downloading' | 'unavailable'

/**
 * The "On-device processing" status the Settings screen shows, derived from
 * the same Prompt + Rewriter capabilities the capture flow relies on for
 * entry extraction/rewriting (`useNewEntryFlow`). `'unavailable'` wins if
 * either capability can't be used at all; otherwise `'downloading'` covers
 * `'downloadable'`/`'downloading'` per {@link isCapabilityUsable} — usable,
 * but not actually ready yet, so it shouldn't be reported as flatly
 * "Enabled". Only once both models are `'available'` is it truly enabled.
 */
export function describeAiProcessingStatus(
  capabilities: Pick<AiCapabilities, 'prompt' | 'rewriter'>,
): AiProcessingStatus {
  const values: AiCapability[] = [capabilities.prompt, capabilities.rewriter]
  if (values.some((value) => !isCapabilityUsable(value))) return 'unavailable'
  if (values.some((value) => value !== 'available')) return 'downloading'
  return 'enabled'
}

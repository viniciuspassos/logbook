// Ambient declarations for Chrome's built-in on-device AI (Gemini Nano).
// These APIs live behind flags / origin trials and are absent from the DOM lib
// typings, so we declare the minimal surface Logbook consumes. Runtime code
// always guards with `typeof LanguageModel === 'undefined'` before use, so a
// missing global degrades gracefully rather than throwing.

type AiAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available'

interface AiCreateMonitor {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: { loaded: number }) => void,
  ): void
}

interface AiCreateOptionsBase {
  signal?: AbortSignal
  monitor?: (monitor: AiCreateMonitor) => void
}

// --- Prompt API (LanguageModel) ---------------------------------------------

interface LanguageModelPromptOptions {
  signal?: AbortSignal
  /** JSON schema constraining the model's structured output. */
  responseConstraint?: object
}

interface LanguageModelSession {
  prompt(input: string, options?: LanguageModelPromptOptions): Promise<string>
  destroy(): void
}

interface LanguageModelCreateOptions extends AiCreateOptionsBase {
  initialPrompts?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  temperature?: number
  topK?: number
}

interface LanguageModelStatic {
  availability(): Promise<AiAvailability>
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>
}

declare const LanguageModel: LanguageModelStatic

// --- Rewriter API -----------------------------------------------------------

type RewriterTone = 'as-is' | 'more-formal' | 'more-casual'
type RewriterFormat = 'as-is' | 'plain-text' | 'markdown'
type RewriterLength = 'as-is' | 'shorter' | 'longer'

interface RewriterCreateOptions extends AiCreateOptionsBase {
  tone?: RewriterTone
  format?: RewriterFormat
  length?: RewriterLength
  sharedContext?: string
}

interface RewriterRewriteOptions {
  signal?: AbortSignal
  context?: string
}

interface RewriterSession {
  rewrite(input: string, options?: RewriterRewriteOptions): Promise<string>
  destroy(): void
}

interface RewriterStatic {
  availability(options?: RewriterCreateOptions): Promise<AiAvailability>
  create(options?: RewriterCreateOptions): Promise<RewriterSession>
}

declare const Rewriter: RewriterStatic

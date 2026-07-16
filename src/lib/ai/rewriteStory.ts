export interface RewriteOptions {
  tone?: RewriterTone
  length?: RewriterLength
  /** Bumped by "Regenerate" to nudge the model toward different phrasing. */
  variant?: number
}

const SHARED_CONTEXT =
  'Rewrite a rough first-person adventure note into a short, vivid, polished ' +
  'journal story. Keep it factual and in the first person; do not invent events.'

const EXCERPT_MAX = 120

/**
 * First sentence of the story, capped at ~120 chars — used as `Entry.excerpt`.
 * Pure and synchronous so the timeline/search cards never wait on the model.
 */
export function deriveExcerpt(story: string): string {
  const trimmed = story.trim()
  if (!trimmed) return ''
  const sentenceEnd = trimmed.search(/[.!?](\s|$)/)
  const firstSentence =
    sentenceEnd === -1 ? trimmed : trimmed.slice(0, sentenceEnd + 1)
  if (firstSentence.length <= EXCERPT_MAX) return firstSentence
  return `${trimmed.slice(0, EXCERPT_MAX).trimEnd()}…`
}

/**
 * Run the on-device Rewriter API to polish a raw note. Throws on any failure
 * (missing API, quota) so callers can fall back to using the raw text.
 */
export async function rewriteStory(
  rawText: string,
  opts?: RewriteOptions & { signal?: AbortSignal },
): Promise<string> {
  if (typeof Rewriter === 'undefined') {
    throw new Error('rewriteStory: Rewriter API unavailable')
  }

  const rewriter = await Rewriter.create({
    signal: opts?.signal,
    tone: opts?.tone ?? 'as-is',
    format: 'plain-text',
    length: opts?.length ?? 'as-is',
    sharedContext: SHARED_CONTEXT,
  })

  try {
    // A per-call context varies with `variant` so "Regenerate" produces fresh
    // phrasing rather than the identical deterministic output.
    const variant = opts?.variant ?? 0
    const context =
      variant > 0
        ? `Offer a fresh phrasing, distinct from previous attempts (variation ${variant}).`
        : undefined
    const result = await rewriter.rewrite(rawText, {
      signal: opts?.signal,
      context,
    })
    return result.trim()
  } finally {
    rewriter.destroy()
  }
}

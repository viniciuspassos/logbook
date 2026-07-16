import type { Entry } from '../types/entry.ts'
import type { ExtractedEntryFields } from './ai/extractEntry.ts'
import { deriveExcerpt } from './ai/rewriteStory.ts'

export interface Draft {
  raw: string
  extracted: ExtractedEntryFields | null
  story: string
}

const DASH = '—'

function fieldOr(value: string | undefined, fallback = DASH): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : fallback
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** Format a Date as the timeline's short "Mon D" label (e.g. "Jul 3"). */
export function formatEntryDate(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`
}

/** Derive a short title from free text when the AI didn't provide one. */
function titleFromText(text: string): string {
  const words = text.trim().split(/\s+/).slice(0, 6).join(' ')
  return words || 'Untitled adventure'
}

/**
 * Build a persistable {@link Entry} from a captured {@link Draft}. Pure: the
 * caller supplies the id and clock so this stays deterministic and testable.
 * Missing AI fields fall back to sensible placeholders so an entry can always
 * be saved, even on the AI-unavailable manual path.
 */
export function buildEntryFromDraft(
  draft: Draft,
  opts: { id: number; date: Date },
): Entry {
  const { extracted, raw, story } = draft
  const effectiveStory = story.trim() || raw.trim()

  return {
    id: opts.id,
    title: extracted ? fieldOr(extracted.title, titleFromText(raw)) : titleFromText(raw),
    shape: extracted?.shape ?? 'triangle',
    activityType: extracted?.activityType?.trim() || undefined,
    location: fieldOr(extracted?.location),
    date: formatEntryDate(opts.date),
    metric: fieldOr(extracted?.metric),
    excerpt: deriveExcerpt(effectiveStory),
    weather: fieldOr(extracted?.weather),
    duration: fieldOr(extracted?.duration),
    difficulty: fieldOr(extracted?.difficulty),
    equipment: fieldOr(extracted?.equipment),
    participants: fieldOr(extracted?.participants),
    raw: raw.trim(),
    story: effectiveStory,
    photoHint: 'new entry',
    media: ['photo one', 'photo two', 'clip'],
    mapX: 50,
    mapY: 50,
  }
}

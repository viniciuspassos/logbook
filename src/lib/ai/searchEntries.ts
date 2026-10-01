import { getLanguageModelAvailability, isCapabilityUsable } from './availability.ts'
import { containsTerm, stem } from '../stemMatch.ts'
import type { Entry } from '../../types/entry.ts'

export interface SearchCriteria {
  keywords: string[]
  activityType?: string
  location?: string
  monthOfYear?: string
  weatherKeyword?: string
}

const SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    keywords: { type: 'array', items: { type: 'string' } },
    activityType: { type: 'string' },
    location: { type: 'string' },
    monthOfYear: { type: 'string' },
    weatherKeyword: { type: 'string' },
  },
  required: ['keywords'],
  additionalProperties: false,
} as const

const SYSTEM_PROMPT =
  'Turn a natural-language search over an adventure logbook into structured ' +
  'criteria. `monthOfYear` should be a full month name if the query mentions a ' +
  'time of year. Only include fields the query actually implies: omit the rest, ' +
  'never a placeholder such as "unknown" or "any".'

/** Stand-ins the model still sometimes returns for a field the query never implied. */
const PLACEHOLDER_VALUES = new Set(['unknown', 'any', 'none', 'n/a'])

/** Words people add to a query ("windy climbing trips") that no entry would contain. */
const GENERIC_TERMS = new Set(['trip', 'adventure', 'outing', 'entry'].map(stem))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A trimmed, non-placeholder string, or undefined for anything else the model sent. */
function meaningful(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed && !PLACEHOLDER_VALUES.has(trimmed.toLowerCase()) ? trimmed : undefined
}

function keywordFallback(query: string): SearchCriteria {
  return { keywords: query.split(/\s+/).map((w) => w.trim()).filter(Boolean) }
}

/**
 * Parse a natural-language query into structured {@link SearchCriteria} using
 * the on-device Prompt API. Never throws — any failure (missing API, quota,
 * unparseable output) degrades to a plain keyword split.
 */
export async function parseSearchQuery(
  query: string,
  opts?: { signal?: AbortSignal },
): Promise<SearchCriteria> {
  if (!isCapabilityUsable(await getLanguageModelAvailability())) return keywordFallback(query)

  let session: LanguageModelSession | undefined
  try {
    session = await LanguageModel.create({
      signal: opts?.signal,
      initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    })
    const response = await session.prompt(query, {
      signal: opts?.signal,
      responseConstraint: SEARCH_SCHEMA,
    })
    const parsed: unknown = JSON.parse(response)
    if (!isRecord(parsed)) return keywordFallback(query)
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.map(meaningful).filter((k): k is string => k !== undefined)
      : []
    return {
      keywords: keywords.length > 0 ? keywords : keywordFallback(query).keywords,
      activityType: meaningful(parsed.activityType),
      location: meaningful(parsed.location),
      monthOfYear: meaningful(parsed.monthOfYear),
      weatherKeyword: meaningful(parsed.weatherKeyword),
    }
  } catch {
    return keywordFallback(query)
  } finally {
    session?.destroy()
  }
}

function entryText(entry: Entry): string {
  return [
    entry.title,
    entry.location,
    entry.excerpt,
    entry.activityType ?? '',
    entry.weather,
    entry.date,
  ].join(' ')
}

/**
 * Pure, synchronous filter applying parsed criteria to the in-memory entries.
 * Matching is by whole word and stem (see stemMatch.ts), so a query's "climbs" finds an
 * entry's "Climbing" — every model keyword must match, and the model rarely
 * repeats the entry's exact word form.
 */
export function applySearchCriteria(entries: Entry[], criteria: SearchCriteria): Entry[] {
  const { activityType, location, monthOfYear, weatherKeyword } = criteria
  const specific = criteria.keywords.filter((kw) => !GENERIC_TERMS.has(stem(kw)))
  // A query that is only "trip" still means "trip".
  const keywords = specific.length > 0 ? specific : criteria.keywords
  // "hiking/climbing" means either one.
  const activities = activityType?.split('/').map((a) => a.trim()).filter(Boolean) ?? []
  return entries.filter((entry) => {
    const text = entryText(entry)
    if (!keywords.every((kw) => containsTerm(text, kw))) return false
    if (
      activities.length > 0 &&
      !activities.some((activity) => containsTerm(entry.activityType ?? '', activity))
    ) {
      return false
    }
    // Places are often named in the story rather than the location field ("over the Alps").
    if (location && !containsTerm(text, location)) return false
    if (monthOfYear && !containsTerm(entry.date, monthOfYear.slice(0, 3))) return false
    if (weatherKeyword && !containsTerm(entry.weather, weatherKeyword)) return false
    return true
  })
}

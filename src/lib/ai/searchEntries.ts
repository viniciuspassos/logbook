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
  'time of year. Only include fields the query actually implies.'

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
  if (typeof LanguageModel === 'undefined') return keywordFallback(query)

  let session: LanguageModelSession | undefined
  try {
    session = await LanguageModel.create({
      signal: opts?.signal,
      initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
    })
    const response = await session.prompt(query, {
      signal: opts?.signal,
      responseConstraint: SEARCH_SCHEMA,
    })
    const parsed = JSON.parse(response) as Partial<SearchCriteria>
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.filter((k): k is string => typeof k === 'string')
      : []
    return {
      keywords: keywords.length > 0 ? keywords : keywordFallback(query).keywords,
      activityType: parsed.activityType,
      location: parsed.location,
      monthOfYear: parsed.monthOfYear,
      weatherKeyword: parsed.weatherKeyword,
    }
  } catch {
    return keywordFallback(query)
  } finally {
    session?.destroy()
  }
}

function matchesText(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
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

/** Pure, synchronous filter applying parsed criteria to the in-memory entries. */
export function applySearchCriteria(entries: Entry[], criteria: SearchCriteria): Entry[] {
  const { keywords, activityType, location, monthOfYear, weatherKeyword } = criteria
  return entries.filter((entry) => {
    const text = entryText(entry)
    if (keywords.length > 0 && !keywords.every((kw) => matchesText(text, kw))) {
      return false
    }
    if (activityType && !matchesText(entry.activityType ?? '', activityType)) return false
    if (location && !matchesText(entry.location, location)) return false
    if (monthOfYear && !matchesText(entry.date, monthOfYear.slice(0, 3))) return false
    if (weatherKeyword && !matchesText(entry.weather, weatherKeyword)) return false
    return true
  })
}

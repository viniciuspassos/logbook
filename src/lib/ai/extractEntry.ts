import type { AdventureShape } from '../../types/entry.ts'

export interface ExtractedEntryFields {
  title: string
  activityType: string
  shape: AdventureShape
  location: string
  weather: string
  duration: string
  difficulty: string
  equipment: string
  participants: string
  metric: string
}

const SHAPES: readonly AdventureShape[] = ['circle', 'triangle', 'diamond']

/**
 * JSON schema handed to the Prompt API via `responseConstraint`. Only the
 * fields the model can reliably infer from any note are `required`; the rest are
 * optional so the model isn't forced to invent a value the transcript never
 * mentioned. `date` and `excerpt` are intentionally absent (stamped locally /
 * derived from the rewritten story).
 */
export const ENTRY_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    activityType: { type: 'string' },
    shape: { type: 'string', enum: SHAPES },
    location: { type: 'string' },
    weather: { type: 'string' },
    duration: { type: 'string' },
    difficulty: { type: 'string', enum: ['Easy', 'Moderate', 'Advanced', 'Expert'] },
    equipment: { type: 'string' },
    participants: { type: 'string' },
    metric: { type: 'string' },
  },
  required: ['title', 'activityType', 'shape'],
  additionalProperties: false,
} as const

const SYSTEM_PROMPT =
  'You extract structured facts from a mountaineer or skydiver\'s spoken adventure note. ' +
  'Respond only with the requested JSON. Choose `shape` as the closest icon bucket: ' +
  'circle for skydiving/aerial jumps, triangle for climbing/mountaineering, ' +
  'diamond for hiking/trekking/skiing. Leave a field out if the note does not mention it.'

/** Defensive keyword mapping from a free-text activity to the 3-value icon bucket. */
export function mapActivityToShape(activityType: string): AdventureShape {
  const a = activityType.toLowerCase()
  if (/(skydiv|parachut|freefall|wingsuit|base jump|jump|aerial)/.test(a)) return 'circle'
  if (/(climb|mountaineer|alpin|boulder|ascent|summit|via ferrata)/.test(a)) return 'triangle'
  if (/(hik|trek|trail|walk|ski|snowshoe|backpack)/.test(a)) return 'diamond'
  return 'triangle'
}

/** Pull the first balanced-looking `{…}` block out of a noisy model response. */
function recoverJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  return text.slice(start, end + 1)
}

function parseResponse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    const recovered = recoverJsonObject(raw)
    if (recovered) return JSON.parse(recovered) as Record<string, unknown>
    throw new Error('extractEntry: model response was not valid JSON')
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Run the on-device Prompt API to turn a raw transcript into structured entry
 * fields. Throws on any failure (missing API, quota exceeded, unparseable
 * output) so callers can fall back to the manual-entry path.
 */
export async function extractEntry(
  rawTranscript: string,
  opts?: { signal?: AbortSignal },
): Promise<ExtractedEntryFields> {
  if (typeof LanguageModel === 'undefined') {
    throw new Error('extractEntry: LanguageModel API unavailable')
  }

  const session = await LanguageModel.create({
    signal: opts?.signal,
    initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  })

  try {
    const response = await session.prompt(rawTranscript, {
      signal: opts?.signal,
      responseConstraint: ENTRY_EXTRACTION_SCHEMA,
    })
    const parsed = parseResponse(response)

    const activityType = str(parsed.activityType)
    const rawShape = str(parsed.shape) as AdventureShape
    const shape = SHAPES.includes(rawShape) ? rawShape : mapActivityToShape(activityType)

    return {
      title: str(parsed.title) || 'Untitled adventure',
      activityType,
      shape,
      location: str(parsed.location),
      weather: str(parsed.weather),
      duration: str(parsed.duration),
      difficulty: str(parsed.difficulty),
      equipment: str(parsed.equipment),
      participants: str(parsed.participants),
      metric: str(parsed.metric),
    }
  } finally {
    session.destroy()
  }
}

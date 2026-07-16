import type { Entry } from '../../types/entry.ts'

/**
 * Shared field-selection rules for every export format. Markdown and the
 * printable (PDF) view must agree on which fields count as "present" and in
 * what order they appear, so that logic lives here rather than in each
 * formatter.
 */

/** The placeholder `buildEntryFromDraft` writes for fields the AI never filled. */
export const DASH = '—'

/** True when a field holds real content rather than empty text or the dash placeholder. */
export function hasValue(value: string | undefined): value is string {
  const trimmed = value?.trim()
  return Boolean(trimmed) && trimmed !== DASH
}

export interface SubtitlePart {
  text: string
  /** The activity type is emphasised (bold) in every format. */
  emphasis: boolean
}

/** The `Activity · Location · Date` parts, skipping any that are blank. */
export function subtitleParts(entry: Entry): SubtitlePart[] {
  const parts: SubtitlePart[] = []
  if (hasValue(entry.activityType)) {
    parts.push({ text: entry.activityType.trim(), emphasis: true })
  }
  if (hasValue(entry.location)) parts.push({ text: entry.location.trim(), emphasis: false })
  if (hasValue(entry.date)) parts.push({ text: entry.date.trim(), emphasis: false })
  return parts
}

export interface DetailField {
  label: string
  value: string
}

/** The labelled detail fields that have a value, in display order. */
export function detailFields(entry: Entry): DetailField[] {
  const fields: Array<[string, string | undefined]> = [
    ['Weather', entry.weather],
    ['Duration', entry.duration],
    ['Difficulty', entry.difficulty],
    ['Equipment', entry.equipment],
    ['Participants', entry.participants],
  ]
  return fields
    .filter((field): field is [string, string] => hasValue(field[1]))
    .map(([label, value]) => ({ label, value: value.trim() }))
}

/** The prose to export: the polished story, or the raw note if it's all we have. */
export function entryStory(entry: Entry): string {
  return entry.story.trim() || entry.raw.trim()
}

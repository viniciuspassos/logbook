import { detailFields, type DetailField } from '../lib/export/entryFields.ts'
import type { Entry } from '../types/entry.ts'

/** Labels shown in the desktop-only "instrument panel" stat strip above the
 *  story; everything else stays in the field grid below it (see
 *  EntryDetailOverlay.tsx). Weather/duration/difficulty/participants read as
 *  scannable, numeric-ish data; equipment is free text and stays below. */
const STAT_STRIP_LABELS = ['Weather', 'Duration', 'Difficulty', 'Participants']

export interface EntryDetailFieldGroups {
  statFields: DetailField[]
  gridFields: DetailField[]
}

/**
 * Splits an entry's populated detail fields (per `entryFields.detailFields`,
 * so both agree on what counts as "has a value") between the desktop stat
 * strip and the field grid below it — a field appears in exactly one group,
 * never both. If fewer than 2 fields would land in the strip, it's skipped
 * entirely (nothing is lost: every populated field still lands in
 * `gridFields`) rather than rendering a mostly-empty instrument panel.
 */
export function splitDetailFields(entry: Entry): EntryDetailFieldGroups {
  const fields = detailFields(entry)
  const stat = fields.filter((field) => STAT_STRIP_LABELS.includes(field.label))
  if (stat.length < 2) {
    return { statFields: [], gridFields: fields }
  }
  const grid = fields.filter((field) => !STAT_STRIP_LABELS.includes(field.label))
  return { statFields: stat, gridFields: grid }
}

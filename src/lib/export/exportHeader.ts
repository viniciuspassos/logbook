/**
 * Formatting for the header block that tops a whole-logbook export. Shared by
 * the Markdown and printable (PDF) documents so the two can't drift apart.
 */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** Format a Date as an export header's "Mon D, YYYY" label. */
export function formatExportDate(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
}

/** "1 entry" / "N entries" — the count phrasing every export header uses. */
export function entryCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'entry' : 'entries'}`
}

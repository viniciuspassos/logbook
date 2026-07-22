import type { Entry } from '../types/entry.ts'

export interface EntryDateGroup {
  date: string
  entries: Entry[]
}

/**
 * Groups already-ordered entries into consecutive runs sharing the same
 * `date` label, preserving the incoming order — used to render the desktop
 * ledger's uppercase date headers (TimelineScreen) without reordering or
 * deduping entries that happen to share a date label non-adjacently (this
 * groups by run, not by date value overall).
 */
export function groupEntriesByDate(entries: Entry[]): EntryDateGroup[] {
  const groups: EntryDateGroup[] = []
  for (const entry of entries) {
    const last = groups[groups.length - 1]
    if (last && last.date === entry.date) {
      last.entries.push(entry)
    } else {
      groups.push({ date: entry.date, entries: [entry] })
    }
  }
  return groups
}

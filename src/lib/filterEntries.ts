import type { Entry } from '../types/entry.ts'

/** Case-insensitive substring match against title, location, and excerpt. */
export function filterEntries(entries: Entry[], query: string): Entry[] {
  const q = query.trim().toLowerCase()
  if (!q) return entries
  return entries.filter((entry) =>
    [entry.title, entry.location, entry.excerpt].some((field) =>
      field.toLowerCase().includes(q),
    ),
  )
}

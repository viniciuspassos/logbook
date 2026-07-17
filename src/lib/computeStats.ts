import type { Entry } from '../types/entry.ts'
import { DASH } from './export/entryFields.ts'

export interface StatTile {
  label: string
  value: string
}

export interface ActivityBreakdown {
  label: string
  count: number
  percent: number
}

export interface Stats {
  tiles: StatTile[]
  breakdown: ActivityBreakdown[]
}

/** Group entries lacking a richer `activityType` under a single bucket. */
const FALLBACK_ACTIVITY = 'Other'

/** The country is the last comma-separated segment of the location string. */
function countryOf(location: string): string {
  const parts = location.split(',')
  return parts[parts.length - 1].trim().toLowerCase()
}

/**
 * Best-effort "days out" for one entry: an explicit "N day(s)" duration counts
 * as N; any other activity (a jump, a few hours) counts as a single day out.
 */
function daysOut(duration: string): number {
  const match = /(\d+)\s*days?/i.exec(duration)
  if (match) return Number(match[1])
  return 1
}

/** Parse a metres figure (e.g. "4,000m") from a metric string, else null. */
function metresOf(metric: string): number | null {
  const match = /([\d,]+)\s*m(?![a-z])/i.exec(metric)
  if (!match) return null
  const value = Number(match[1].replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
}

function formatMetres(value: number): string {
  return `${value.toLocaleString('en-US')}m`
}

function buildBreakdown(entries: Entry[]): ActivityBreakdown[] {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    const label = entry.activityType?.trim() || FALLBACK_ACTIVITY
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const total = entries.length
  return [...counts.entries()]
    .map(([label, count]) => ({
      label,
      count,
      percent: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/**
 * Derive the Stats screen's summary tiles and activity breakdown purely from
 * the persisted entries. All parsing is best-effort over the free-text metric
 * and duration fields, degrading to a dash / single-day rather than throwing.
 */
export function computeStats(entries: Entry[]): Stats {
  const countries = new Set(
    entries.map((e) => countryOf(e.location)).filter((c) => c.length > 0),
  )
  const totalDays = entries.reduce((sum, e) => sum + daysOut(e.duration), 0)
  const highest = entries
    .map((e) => metresOf(e.metric))
    .filter((m): m is number => m !== null)
    .reduce((max, m) => Math.max(max, m), 0)

  const tiles: StatTile[] = [
    { label: 'Adventures', value: String(entries.length) },
    { label: 'Days out', value: String(totalDays) },
    { label: 'Countries', value: String(countries.size) },
    { label: 'Highest point', value: highest > 0 ? formatMetres(highest) : DASH },
  ]

  return { tiles, breakdown: buildBreakdown(entries) }
}

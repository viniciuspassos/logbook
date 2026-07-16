import { computeStats } from './computeStats.ts'
import type { Entry } from '../types/entry.ts'

function makeEntry(overrides: Partial<Entry> & { id: number }): Entry {
  return {
    title: `Entry ${overrides.id}`,
    shape: 'triangle',
    location: 'Somewhere',
    date: 'Jul 3',
    metric: '',
    excerpt: '',
    weather: '',
    duration: '',
    difficulty: '',
    equipment: '',
    participants: '',
    raw: '',
    story: '',
    photoHint: '',
    media: ['a', 'b', 'c'],
    mapX: 50,
    mapY: 50,
    ...overrides,
  }
}

function tileValue(entries: Entry[], label: string): string | undefined {
  return computeStats(entries).tiles.find((t) => t.label === label)?.value
}

describe('computeStats', () => {
  it('returns zeroed tiles and no breakdown for an empty list', () => {
    const stats = computeStats([])
    expect(tileValue([], 'Adventures')).toBe('0')
    expect(stats.breakdown).toEqual([])
  })

  it('counts adventures', () => {
    const entries = [makeEntry({ id: 1 }), makeEntry({ id: 2 })]
    expect(tileValue(entries, 'Adventures')).toBe('2')
  })

  it('counts distinct countries from the last location segment', () => {
    const entries = [
      makeEntry({ id: 1, location: 'Interlaken, Switzerland' }),
      makeEntry({ id: 2, location: 'Yosemite, USA' }),
      makeEntry({ id: 3, location: 'Nepal' }),
      makeEntry({ id: 4, location: 'Pokhara, Nepal' }),
    ]
    expect(tileValue(entries, 'Countries')).toBe('3')
  })

  it('sums days out from duration text, counting non-day activities as one day', () => {
    const entries = [
      makeEntry({ id: 1, duration: '4 days' }),
      makeEntry({ id: 2, duration: '45s freefall' }),
      makeEntry({ id: 3, duration: '6h' }),
    ]
    expect(tileValue(entries, 'Days out')).toBe('6')
  })

  it('reports the highest point in metres, formatted with a thousands separator', () => {
    const entries = [
      makeEntry({ id: 1, metric: '4,000m · 45s freefall' }),
      makeEntry({ id: 2, metric: '2,892m · Grade II' }),
      makeEntry({ id: 3, metric: '71km · 4 days' }),
    ]
    expect(tileValue(entries, 'Highest point')).toBe('4,000m')
  })

  it('shows a dash for highest point when no metric has metres', () => {
    const entries = [makeEntry({ id: 1, metric: '71km · 4 days' })]
    expect(tileValue(entries, 'Highest point')).toBe('—')
  })

  it('builds an activity breakdown sorted by count with percentages', () => {
    const entries = [
      makeEntry({ id: 1, activityType: 'Climbing' }),
      makeEntry({ id: 2, activityType: 'Climbing' }),
      makeEntry({ id: 3, activityType: 'Trekking' }),
      makeEntry({ id: 4, activityType: 'Skydiving' }),
    ]
    const { breakdown } = computeStats(entries)
    expect(breakdown[0]).toEqual({ label: 'Climbing', count: 2, percent: 50 })
    // Equal counts break ties alphabetically for a stable order.
    expect(breakdown.map((b) => b.label)).toEqual(['Climbing', 'Skydiving', 'Trekking'])
    expect(breakdown.every((b) => b.count >= 1)).toBe(true)
  })

  it('falls back to a shape-derived label when activityType is missing', () => {
    const entries = [makeEntry({ id: 1, shape: 'circle', activityType: undefined })]
    const { breakdown } = computeStats(entries)
    expect(breakdown).toHaveLength(1)
    expect(breakdown[0].label).toBe('Other')
  })
})

import { applySearchCriteria, parseSearchQuery } from './searchEntries.ts'
import type { Entry } from '../../types/entry.ts'

type Globals = typeof globalThis & { LanguageModel?: unknown }
const g = globalThis as Globals

function entry(overrides: Partial<Entry>): Entry {
  return {
    id: 1,
    title: 'Trip',
    shape: 'triangle',
    location: 'Somewhere',
    date: 'Jul 3',
    metric: '',
    excerpt: '',
    weather: 'Clear',
    duration: '',
    difficulty: '',
    equipment: '',
    participants: '',
    raw: '',
    story: '',
    photoHint: '',
    media: ['', '', ''],
    mapX: 0,
    mapY: 0,
    ...overrides,
  }
}

afterEach(() => {
  delete g.LanguageModel
})

describe('parseSearchQuery', () => {
  it('falls back to a keyword split when the API is absent', async () => {
    expect(await parseSearchQuery('windy climbs july')).toEqual({
      keywords: ['windy', 'climbs', 'july'],
    })
  })

  it('returns structured criteria from the model', async () => {
    const destroy = jest.fn()
    g.LanguageModel = {
      create: jest.fn().mockResolvedValue({
        prompt: jest
          .fn()
          .mockResolvedValue(
            JSON.stringify({ keywords: ['climb'], monthOfYear: 'July', weatherKeyword: 'windy' }),
          ),
        destroy,
      }),
      availability: jest.fn(),
    }
    const criteria = await parseSearchQuery('windy climbs in July')
    expect(criteria.keywords).toEqual(['climb'])
    expect(criteria.monthOfYear).toBe('July')
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('falls back to keywords when the model output is unparseable', async () => {
    g.LanguageModel = {
      create: jest.fn().mockResolvedValue({
        prompt: jest.fn().mockResolvedValue('garbage'),
        destroy: jest.fn(),
      }),
      availability: jest.fn(),
    }
    expect(await parseSearchQuery('snowy hikes')).toEqual({ keywords: ['snowy', 'hikes'] })
  })
})

describe('applySearchCriteria', () => {
  const entries = [
    entry({ id: 1, title: 'Pico', activityType: 'Climbing', weather: 'Windy', date: 'Jul 3' }),
    entry({ id: 2, title: 'ABC', activityType: 'Hiking', weather: 'Clear', date: 'Mar 9' }),
  ]

  it('returns all entries for empty keywords', () => {
    expect(applySearchCriteria(entries, { keywords: [] })).toHaveLength(2)
  })

  it('requires every keyword to match', () => {
    expect(applySearchCriteria(entries, { keywords: ['pico', 'windy'] })).toHaveLength(1)
    expect(applySearchCriteria(entries, { keywords: ['pico', 'clear'] })).toHaveLength(0)
  })

  it('filters by activityType', () => {
    const result = applySearchCriteria(entries, { keywords: [], activityType: 'hiking' })
    expect(result.map((e) => e.id)).toEqual([2])
  })

  it('filters by month via the date abbreviation', () => {
    const result = applySearchCriteria(entries, { keywords: [], monthOfYear: 'July' })
    expect(result.map((e) => e.id)).toEqual([1])
  })

  it('filters by weather keyword', () => {
    const result = applySearchCriteria(entries, { keywords: [], weatherKeyword: 'windy' })
    expect(result.map((e) => e.id)).toEqual([1])
  })
})

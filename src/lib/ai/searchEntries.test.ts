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
      availability: jest.fn().mockResolvedValue('available'),
    }
    const criteria = await parseSearchQuery('windy climbs in July')
    expect(criteria.keywords).toEqual(['climb'])
    expect(criteria.monthOfYear).toBe('July')
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  function mockModelResponse(response: string) {
    g.LanguageModel = {
      create: jest.fn().mockResolvedValue({
        prompt: jest.fn().mockResolvedValue(response),
        destroy: jest.fn(),
      }),
      availability: jest.fn().mockResolvedValue('available'),
    }
  }

  it('drops placeholder values the model uses for fields the query never implied', async () => {
    mockModelResponse(
      JSON.stringify({
        keywords: ['windy', 'unknown', 'N/A', 'None'],
        activityType: ' climbing ',
        location: 'Unknown',
        monthOfYear: 'any',
        weatherKeyword: ' ',
      }),
    )
    expect(await parseSearchQuery('windy climbs')).toEqual({
      keywords: ['windy'],
      activityType: 'climbing',
      location: undefined,
      monthOfYear: undefined,
      weatherKeyword: undefined,
    })
  })

  it('ignores fields of the wrong type', async () => {
    mockModelResponse(JSON.stringify({ keywords: ['windy', 7], location: 42 }))
    const criteria = await parseSearchQuery('windy')
    expect(criteria.keywords).toEqual(['windy'])
    expect(criteria.location).toBeUndefined()
  })

  it('falls back to keywords when the model returns JSON that is not an object', async () => {
    mockModelResponse('null')
    expect(await parseSearchQuery('snowy hikes')).toEqual({ keywords: ['snowy', 'hikes'] })
  })

  it('tells the model to omit fields instead of using placeholders', async () => {
    const create = jest.fn().mockResolvedValue({
      prompt: jest.fn().mockResolvedValue(JSON.stringify({ keywords: ['x'] })),
      destroy: jest.fn(),
    })
    g.LanguageModel = { create, availability: jest.fn().mockResolvedValue('available') }
    await parseSearchQuery('x')
    const systemPrompt: string = create.mock.calls[0][0].initialPrompts[0].content
    expect(systemPrompt).toMatch(/never a placeholder such as "unknown" or "any"/)
  })

  it('falls back to keywords when the model output is unparseable', async () => {
    g.LanguageModel = {
      create: jest.fn().mockResolvedValue({
        prompt: jest.fn().mockResolvedValue('garbage'),
        destroy: jest.fn(),
      }),
      availability: jest.fn().mockResolvedValue('available'),
    }
    expect(await parseSearchQuery('snowy hikes')).toEqual({ keywords: ['snowy', 'hikes'] })
  })

  it('falls back to a keyword split without creating a session when availability reports unavailable', async () => {
    const create = jest.fn()
    g.LanguageModel = { create, availability: jest.fn().mockResolvedValue('unavailable') }
    expect(await parseSearchQuery('windy climbs july')).toEqual({
      keywords: ['windy', 'climbs', 'july'],
    })
    expect(create).not.toHaveBeenCalled()
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

  it('matches inflected keywords, so "windy climbs in July" finds a windy Climbing entry', () => {
    const result = applySearchCriteria(entries, {
      keywords: ['windy', 'climbs'],
      activityType: 'climbing',
      monthOfYear: 'July',
      weatherKeyword: 'windy',
    })
    expect(result.map((e) => e.id)).toEqual([1])
  })

  it('ignores generic words like "trips" that no entry would contain', () => {
    const result = applySearchCriteria(entries, { keywords: ['windy', 'climbing', 'trips'] })
    expect(result.map((e) => e.id)).toEqual([1])
  })

  it('still searches for a generic word when it is the whole query', () => {
    const roadTrip = entry({ id: 3, title: 'Road trip to Moab' })
    const result = applySearchCriteria([...entries, roadTrip], { keywords: ['trip'] })
    expect(result.map((e) => e.id)).toEqual([3])
  })

  it('ignores stopwords from a plain keyword split, so "climbing in Yosemite" still matches', () => {
    const capitan = entry({ id: 3, activityType: 'Climbing', location: 'Yosemite, USA' })
    const result = applySearchCriteria([...entries, capitan], {
      keywords: ['climbing', 'in', 'Yosemite'],
    })
    expect(result.map((e) => e.id)).toEqual([3])
  })

  it('matches a location mentioned anywhere in the entry, not only its location field', () => {
    const alps = entry({ id: 3, location: 'Interlaken, Switzerland', excerpt: 'Clear skies over the Alps' })
    const result = applySearchCriteria([...entries, alps], { keywords: [], location: 'Alps' })
    expect(result.map((e) => e.id)).toEqual([3])
  })

  it('accepts any of several slash-separated activity types', () => {
    const result = applySearchCriteria(entries, { keywords: [], activityType: 'hiking/climbing' })
    expect(result.map((e) => e.id)).toEqual([1, 2])
  })
})

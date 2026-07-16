import { detailFields, entryStory, hasValue, subtitleParts } from './entryFields.ts'
import type { Entry } from '../../types/entry.ts'

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

describe('hasValue', () => {
  it.each([
    ['Windy', true],
    ['  Windy  ', true],
    ['', false],
    ['   ', false],
    [undefined, false],
    // The dash is the "AI never filled this" placeholder, not real content.
    ['—', false],
  ])('treats %p as %p', (value, expected) => {
    expect(hasValue(value)).toBe(expected)
  })
})

describe('subtitleParts', () => {
  it('emphasises the activity type and keeps location and date plain', () => {
    const parts = subtitleParts(
      makeEntry({ id: 1, activityType: 'Skydiving', location: 'Interlaken', date: 'Jul 3' }),
    )
    expect(parts).toEqual([
      { text: 'Skydiving', emphasis: true },
      { text: 'Interlaken', emphasis: false },
      { text: 'Jul 3', emphasis: false },
    ])
  })

  it('skips parts with no value', () => {
    const parts = subtitleParts(
      makeEntry({ id: 1, activityType: undefined, location: '', date: 'Jul 3' }),
    )
    expect(parts).toEqual([{ text: 'Jul 3', emphasis: false }])
  })
})

describe('detailFields', () => {
  it('returns only fields with values, in display order', () => {
    const fields = detailFields(
      makeEntry({
        id: 1,
        weather: 'Windy',
        duration: '—',
        difficulty: '',
        equipment: 'Ropes',
        participants: 'Solo',
      }),
    )
    expect(fields).toEqual([
      { label: 'Weather', value: 'Windy' },
      { label: 'Equipment', value: 'Ropes' },
      { label: 'Participants', value: 'Solo' },
    ])
  })

  it('returns an empty list when nothing is filled in', () => {
    expect(detailFields(makeEntry({ id: 1 }))).toEqual([])
  })
})

describe('entryStory', () => {
  it('prefers the polished story', () => {
    expect(entryStory(makeEntry({ id: 1, story: 'Polished.', raw: 'rough' }))).toBe('Polished.')
  })

  it('falls back to the raw note when there is no story', () => {
    expect(entryStory(makeEntry({ id: 1, story: '   ', raw: 'rough note' }))).toBe('rough note')
  })

  it('is empty when neither is present', () => {
    expect(entryStory(makeEntry({ id: 1 }))).toBe('')
  })
})

import { groupEntriesByDate } from './timelineGrouping.ts'
import type { Entry } from '../types/entry.ts'

function makeEntry(id: number, date: string): Entry {
  return {
    id,
    title: `Entry ${id}`,
    shape: 'triangle',
    location: 'Somewhere',
    date,
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
  }
}

describe('groupEntriesByDate', () => {
  it('returns an empty list for no entries', () => {
    expect(groupEntriesByDate([])).toEqual([])
  })

  it('puts a single entry in its own group', () => {
    const entry = makeEntry(1, 'Jul 3')
    expect(groupEntriesByDate([entry])).toEqual([{ date: 'Jul 3', entries: [entry] }])
  })

  it('merges consecutive entries sharing the same date into one group', () => {
    const a = makeEntry(2, 'Jul 3')
    const b = makeEntry(1, 'Jul 3')
    expect(groupEntriesByDate([a, b])).toEqual([{ date: 'Jul 3', entries: [a, b] }])
  })

  it('starts a new group when the date changes, preserving order', () => {
    const a = makeEntry(3, 'Jul 3')
    const b = makeEntry(2, 'Jun 21')
    const c = makeEntry(1, 'Jun 21')
    expect(groupEntriesByDate([a, b, c])).toEqual([
      { date: 'Jul 3', entries: [a] },
      { date: 'Jun 21', entries: [b, c] },
    ])
  })

  it('keeps non-adjacent entries with the same date in separate groups', () => {
    const a = makeEntry(3, 'Jul 3')
    const b = makeEntry(2, 'Jun 21')
    const c = makeEntry(1, 'Jul 3')
    expect(groupEntriesByDate([a, b, c])).toEqual([
      { date: 'Jul 3', entries: [a] },
      { date: 'Jun 21', entries: [b] },
      { date: 'Jul 3', entries: [c] },
    ])
  })
})

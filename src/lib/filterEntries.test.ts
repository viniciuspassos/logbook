import { filterEntries } from './filterEntries.ts'
import { entries } from '../data/entries.ts'

describe('filterEntries', () => {
  it('returns all entries for an empty query', () => {
    expect(filterEntries(entries, '')).toEqual(entries)
    expect(filterEntries(entries, '   ')).toEqual(entries)
  })

  it('matches case-insensitively against the title', () => {
    const result = filterEntries(entries, 'annapurna')
    expect(result.map((e) => e.id)).toEqual([1])
  })

  it('matches against location', () => {
    const result = filterEntries(entries, 'brazil')
    expect(result.map((e) => e.id)).toEqual([4])
  })

  it('matches against excerpt', () => {
    const result = filterEntries(entries, 'granite skyline')
    expect(result.map((e) => e.id)).toEqual([3])
  })

  it('returns an empty array when nothing matches', () => {
    expect(filterEntries(entries, 'antarctica')).toEqual([])
  })
})

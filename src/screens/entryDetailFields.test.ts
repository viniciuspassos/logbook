import { splitDetailFields } from './entryDetailFields.ts'
import type { Entry } from '../types/entry.ts'

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 1,
    title: 'Test entry',
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

describe('splitDetailFields', () => {
  it('splits four or more populated stat fields into the strip and leaves the rest for the grid', () => {
    const entry = makeEntry({
      weather: 'Clear',
      duration: '45s',
      difficulty: 'Advanced',
      participants: 'Solo',
      equipment: 'Rig, GoPro',
    })

    const { statFields, gridFields } = splitDetailFields(entry)

    expect(statFields.map((f) => f.label)).toEqual([
      'Weather',
      'Duration',
      'Difficulty',
      'Participants',
    ])
    expect(gridFields.map((f) => f.label)).toEqual(['Equipment'])
  })

  it('skips the strip and keeps everything in the grid when fewer than 2 stat fields have a value', () => {
    const entry = makeEntry({ duration: '45s', equipment: 'Rig' })

    const { statFields, gridFields } = splitDetailFields(entry)

    expect(statFields).toEqual([])
    expect(gridFields.map((f) => f.label)).toEqual(['Duration', 'Equipment'])
  })

  it('returns both groups empty when no field has a value', () => {
    const entry = makeEntry()

    const { statFields, gridFields } = splitDetailFields(entry)

    expect(statFields).toEqual([])
    expect(gridFields).toEqual([])
  })

  it('renders exactly two stat fields into the strip once the 2-field threshold is met', () => {
    const entry = makeEntry({ weather: 'Clear', duration: '45s', equipment: 'Rig' })

    const { statFields, gridFields } = splitDetailFields(entry)

    expect(statFields.map((f) => f.label)).toEqual(['Weather', 'Duration'])
    expect(gridFields.map((f) => f.label)).toEqual(['Equipment'])
  })
})

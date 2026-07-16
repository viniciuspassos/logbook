import { buildEntryFromDraft, formatEntryDate } from './buildEntry.ts'
import type { ExtractedEntryFields } from './ai/extractEntry.ts'

const extracted: ExtractedEntryFields = {
  title: 'Pico da Bandeira',
  activityType: 'Climbing',
  shape: 'triangle',
  location: 'Brazil',
  weather: 'Windy',
  duration: '6h',
  difficulty: 'Moderate',
  equipment: 'Helmet, ropes',
  participants: 'Group of 3',
  metric: '2,892m',
}

describe('formatEntryDate', () => {
  it('formats as a short month-day label', () => {
    expect(formatEntryDate(new Date(2026, 6, 3))).toBe('Jul 3')
    expect(formatEntryDate(new Date(2026, 0, 21))).toBe('Jan 21')
  })
})

describe('buildEntryFromDraft', () => {
  const date = new Date(2026, 6, 15)

  it('maps extracted fields onto a full Entry', () => {
    const entry = buildEntryFromDraft(
      { raw: 'climbed pico', extracted, story: 'The wind never let up. It was worth it.' },
      { id: 7, date },
    )
    expect(entry.id).toBe(7)
    expect(entry.title).toBe('Pico da Bandeira')
    expect(entry.shape).toBe('triangle')
    expect(entry.activityType).toBe('Climbing')
    expect(entry.location).toBe('Brazil')
    expect(entry.date).toBe('Jul 15')
    expect(entry.excerpt).toBe('The wind never let up.')
    expect(entry.story).toContain('worth it')
  })

  it('fills placeholders and derives a title on the manual path', () => {
    const entry = buildEntryFromDraft(
      { raw: 'Quick evening trail run near home', extracted: null, story: '' },
      { id: 1, date },
    )
    expect(entry.title).toBe('Quick evening trail run near home')
    expect(entry.shape).toBe('triangle')
    expect(entry.activityType).toBeUndefined()
    expect(entry.location).toBe('—')
    expect(entry.weather).toBe('—')
    // Story falls back to the raw text when no polished story exists.
    expect(entry.story).toBe('Quick evening trail run near home')
  })

  it('defaults empty extracted strings to a dash', () => {
    const entry = buildEntryFromDraft(
      { raw: 'note', extracted: { ...extracted, location: '', weather: '' }, story: 'A story.' },
      { id: 2, date },
    )
    expect(entry.location).toBe('—')
    expect(entry.weather).toBe('—')
  })
})

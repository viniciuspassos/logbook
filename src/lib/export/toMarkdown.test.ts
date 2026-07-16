import { entriesToMarkdown, entryToMarkdown, markdownFilename, slugify } from './toMarkdown.ts'
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

describe('slugify', () => {
  it('lowercases and hyphenates words', () => {
    expect(slugify('Solo Tandem Jump')).toBe('solo-tandem-jump')
  })

  it('strips punctuation and collapses separators', () => {
    expect(slugify("Pico da Bandeira — it's windy!")).toBe('pico-da-bandeira-it-s-windy')
  })

  it('falls back to "entry" for text with no usable characters', () => {
    expect(slugify('!!!')).toBe('entry')
  })
})

describe('entryToMarkdown', () => {
  it('renders title, subtitle, story, details and raw notes', () => {
    const md = entryToMarkdown(
      makeEntry({
        id: 1,
        title: 'Solo tandem jump',
        activityType: 'Skydiving',
        location: 'Interlaken, Switzerland',
        date: 'Jul 3',
        metric: '4,000m · 45s freefall',
        story: 'The plane door opened onto nothing but glacier and blue.',
        weather: 'Clear, light wind',
        duration: '45s freefall',
        difficulty: 'Advanced',
        equipment: 'Tandem rig, GoPro',
        participants: 'Solo w/ instructor',
        raw: 'Did the tandem jump over Interlaken today.',
      }),
    )

    expect(md).toContain('# Solo tandem jump')
    expect(md).toContain('**Skydiving** · Interlaken, Switzerland · Jul 3')
    expect(md).toContain('4,000m · 45s freefall')
    expect(md).toContain('The plane door opened onto nothing but glacier and blue.')
    expect(md).toContain('- **Weather:** Clear, light wind')
    expect(md).toContain('- **Equipment:** Tandem rig, GoPro')
    expect(md).toContain('> Did the tandem jump over Interlaken today.')
  })

  it('omits the activity type from the subtitle when absent', () => {
    const md = entryToMarkdown(
      makeEntry({ id: 1, activityType: undefined, location: 'Nepal', date: 'Jul 3' }),
    )
    expect(md).toContain('Nepal · Jul 3')
    expect(md).not.toContain('**undefined**')
  })

  it('omits empty and placeholder-dash detail fields', () => {
    const md = entryToMarkdown(
      makeEntry({ id: 1, weather: 'Windy', duration: '—', difficulty: '' }),
    )
    expect(md).toContain('- **Weather:** Windy')
    expect(md).not.toContain('Duration')
    expect(md).not.toContain('Difficulty')
  })

  it('omits the details section entirely when no fields have values', () => {
    const md = entryToMarkdown(makeEntry({ id: 1 }))
    expect(md).not.toContain('## Details')
  })

  it('omits the raw notes section when there are no raw notes', () => {
    const md = entryToMarkdown(makeEntry({ id: 1, raw: '' }))
    expect(md).not.toContain('## Raw notes')
  })

  it('quotes every line of a multi-line raw note', () => {
    const md = entryToMarkdown(makeEntry({ id: 1, raw: 'line one\nline two' }))
    expect(md).toContain('> line one\n> line two')
  })

  it('ends with a single trailing newline', () => {
    const md = entryToMarkdown(makeEntry({ id: 1, story: 'A story.' }))
    expect(md.endsWith('\n')).toBe(true)
    expect(md.endsWith('\n\n')).toBe(false)
  })
})

describe('entriesToMarkdown', () => {
  it('renders a document header with the entry count and export date', () => {
    const md = entriesToMarkdown([makeEntry({ id: 1 }), makeEntry({ id: 2 })], {
      date: new Date(2026, 6, 16),
    })
    expect(md).toContain('# Logbook')
    expect(md).toContain('2 entries')
    expect(md).toContain('Jul 16, 2026')
  })

  it('uses the singular noun for a single entry', () => {
    const md = entriesToMarkdown([makeEntry({ id: 1 })], { date: new Date(2026, 6, 16) })
    expect(md).toContain('1 entry')
    expect(md).not.toContain('1 entries')
  })

  it('separates entries with a horizontal rule', () => {
    const md = entriesToMarkdown(
      [makeEntry({ id: 1, title: 'First' }), makeEntry({ id: 2, title: 'Second' })],
      { date: new Date(2026, 6, 16) },
    )
    expect(md).toContain('# First')
    expect(md).toContain('# Second')
    expect(md).toContain('\n---\n')
  })

  it('handles an empty logbook without a trailing rule', () => {
    const md = entriesToMarkdown([], { date: new Date(2026, 6, 16) })
    expect(md).toContain('0 entries')
    expect(md).not.toContain('\n---\n')
  })
})

describe('markdownFilename', () => {
  it('combines a slugified title with the entry id', () => {
    expect(markdownFilename(makeEntry({ id: 7, title: 'Solo tandem jump' }))).toBe(
      'solo-tandem-jump-7.md',
    )
  })
})

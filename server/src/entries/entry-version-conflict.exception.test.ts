import { ConflictException, HttpStatus } from '@nestjs/common'
import { EntryVersionConflictException } from './entry-version-conflict.exception'
import type { Entry } from './entry.entity'

function fakeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 1,
    title: 'Solo tandem jump',
    shape: 'circle',
    location: 'Interlaken',
    date: 'Jul 3',
    metric: '4,000m',
    excerpt: 'excerpt',
    weather: 'clear',
    duration: '45s',
    difficulty: 'Advanced',
    equipment: 'rig',
    participants: 'solo',
    raw: 'raw text',
    story: 'story text',
    photoHint: 'hint',
    media: ['a', 'b', 'c'],
    mapX: 10,
    mapY: 20,
    version: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('EntryVersionConflictException', () => {
  it('is a ConflictException (409)', () => {
    const exception = new EntryVersionConflictException(fakeEntry())

    expect(exception).toBeInstanceOf(ConflictException)
    expect(exception.getStatus()).toBe(HttpStatus.CONFLICT)
  })

  it('carries the current entry state in its response body', () => {
    const entry = fakeEntry({ id: 42, version: 7, title: 'Server-side title' })
    const exception = new EntryVersionConflictException(entry)

    const response = exception.getResponse() as { currentEntry: Entry; message: string }

    expect(response.currentEntry).toBe(entry)
    expect(typeof response.message).toBe('string')
  })
})

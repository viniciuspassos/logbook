import type { Repository } from 'typeorm'
import { EntriesRepository } from './entries.repository'
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeRepoMock() {
  return {
    find: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    merge: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<Repository<Entry>>
}

describe('EntriesRepository', () => {
  it('findAll delegates to the underlying repository, newest first', async () => {
    const ormRepo = makeRepoMock()
    const entries = [fakeEntry({ id: 2 }), fakeEntry({ id: 1 })]
    ormRepo.find.mockResolvedValue(entries)
    const repo = new EntriesRepository(ormRepo)

    const result = await repo.findAll()

    expect(ormRepo.find).toHaveBeenCalledWith({ order: { id: 'DESC' } })
    expect(result).toBe(entries)
  })

  it('findById returns the entry when found', async () => {
    const ormRepo = makeRepoMock()
    const entry = fakeEntry()
    ormRepo.findOneBy.mockResolvedValue(entry)
    const repo = new EntriesRepository(ormRepo)

    const result = await repo.findById(1)

    expect(ormRepo.findOneBy).toHaveBeenCalledWith({ id: 1 })
    expect(result).toBe(entry)
  })

  it('findById returns null when not found', async () => {
    const ormRepo = makeRepoMock()
    ormRepo.findOneBy.mockResolvedValue(null)
    const repo = new EntriesRepository(ormRepo)

    const result = await repo.findById(999)

    expect(result).toBeNull()
  })

  it('create builds and saves a new entity', async () => {
    const ormRepo = makeRepoMock()
    const draft = fakeEntry({ id: undefined as unknown as number })
    const saved = fakeEntry({ id: 5 })
    ormRepo.create.mockReturnValue(draft)
    ormRepo.save.mockResolvedValue(saved)
    const repo = new EntriesRepository(ormRepo)

    const result = await repo.create({ title: 'x' } as unknown as Entry)

    expect(ormRepo.create).toHaveBeenCalledWith({ title: 'x' })
    expect(ormRepo.save).toHaveBeenCalledWith(draft)
    expect(result).toBe(saved)
  })

  it('update merges changes into the existing entity and saves it', async () => {
    const ormRepo = makeRepoMock()
    const existing = fakeEntry()
    const merged = fakeEntry({ title: 'New title' })
    ormRepo.findOneBy.mockResolvedValue(existing)
    ormRepo.merge.mockReturnValue(merged)
    ormRepo.save.mockResolvedValue(merged)
    const repo = new EntriesRepository(ormRepo)

    const result = await repo.update(1, { title: 'New title' })

    expect(ormRepo.merge).toHaveBeenCalledWith(existing, { title: 'New title' })
    expect(ormRepo.save).toHaveBeenCalledWith(merged)
    expect(result).toBe(merged)
  })

  it('update returns null when the entry does not exist', async () => {
    const ormRepo = makeRepoMock()
    ormRepo.findOneBy.mockResolvedValue(null)
    const repo = new EntriesRepository(ormRepo)

    const result = await repo.update(999, { title: 'x' })

    expect(result).toBeNull()
    expect(ormRepo.save).not.toHaveBeenCalled()
  })

  it('remove returns true when a row was deleted', async () => {
    const ormRepo = makeRepoMock()
    ormRepo.delete.mockResolvedValue({ affected: 1, raw: {} })
    const repo = new EntriesRepository(ormRepo)

    const result = await repo.remove(1)

    expect(ormRepo.delete).toHaveBeenCalledWith(1)
    expect(result).toBe(true)
  })

  it('remove returns false when nothing was deleted', async () => {
    const ormRepo = makeRepoMock()
    ormRepo.delete.mockResolvedValue({ affected: 0, raw: {} })
    const repo = new EntriesRepository(ormRepo)

    const result = await repo.remove(999)

    expect(result).toBe(false)
  })
})

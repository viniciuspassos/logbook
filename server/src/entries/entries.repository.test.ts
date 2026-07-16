import type { Repository } from 'typeorm'
import { EntriesRepository } from './entries.repository'
import type { Entry } from './entry.entity'
import type { Attachment } from '../attachments/attachment.entity'

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

function fakeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 1,
    entryId: 1,
    originalFilename: 'summit.jpg',
    storageKey: 'key-1',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    userId: null,
    createdAt: new Date(),
    ...overrides,
  }
}

/** Bare-bones stand-in for the EntityManager handed to a transaction callback. */
function makeFakeManager() {
  return {
    findOneBy: jest.fn(),
    findBy: jest.fn(),
    delete: jest.fn(),
  }
}

function makeRepoMock() {
  const fakeManager = makeFakeManager()
  const ormRepo = {
    find: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    merge: jest.fn(),
    delete: jest.fn(),
    manager: {
      transaction: jest.fn(
        (cb: (manager: typeof fakeManager) => Promise<unknown>) => cb(fakeManager),
      ),
    },
  } as unknown as jest.Mocked<Repository<Entry>> & { manager: { transaction: jest.Mock } }
  return { ormRepo, fakeManager }
}

describe('EntriesRepository', () => {
  it('findAll delegates to the underlying repository, newest first', async () => {
    const { ormRepo } = makeRepoMock()
    const entries = [fakeEntry({ id: 2 }), fakeEntry({ id: 1 })]
    ormRepo.find.mockResolvedValue(entries)
    const repo = new EntriesRepository(ormRepo)

    const result = await repo.findAll()

    expect(ormRepo.find).toHaveBeenCalledWith({ order: { id: 'DESC' } })
    expect(result).toBe(entries)
  })

  it('findById returns the entry when found', async () => {
    const { ormRepo } = makeRepoMock()
    const entry = fakeEntry()
    ormRepo.findOneBy.mockResolvedValue(entry)
    const repo = new EntriesRepository(ormRepo)

    const result = await repo.findById(1)

    expect(ormRepo.findOneBy).toHaveBeenCalledWith({ id: 1 })
    expect(result).toBe(entry)
  })

  it('findById returns null when not found', async () => {
    const { ormRepo } = makeRepoMock()
    ormRepo.findOneBy.mockResolvedValue(null)
    const repo = new EntriesRepository(ormRepo)

    const result = await repo.findById(999)

    expect(result).toBeNull()
  })

  it('create builds and saves a new entity', async () => {
    const { ormRepo } = makeRepoMock()
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
    const { ormRepo } = makeRepoMock()
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
    const { ormRepo } = makeRepoMock()
    ormRepo.findOneBy.mockResolvedValue(null)
    const repo = new EntriesRepository(ormRepo)

    const result = await repo.update(999, { title: 'x' })

    expect(result).toBeNull()
    expect(ormRepo.save).not.toHaveBeenCalled()
  })

  // NOTE: the old plain `remove(id)` method (delete-the-entry-row-only) was
  // replaced by `removeCascade` below as part of #20's cascade-delete
  // decision — there is no longer a code path that deletes an Entry without
  // also cascading to its Attachments, so the old method and its two tests
  // ("remove returns true/false") were removed rather than kept alongside
  // dead code. Their behaviour (row deleted -> truthy result, missing row ->
  // falsy/null result) is fully covered by the removeCascade tests below.

  it('removeCascade returns null without deleting anything when the entry does not exist', async () => {
    const { ormRepo, fakeManager } = makeRepoMock()
    fakeManager.findOneBy.mockResolvedValue(null)
    const repo = new EntriesRepository(ormRepo)

    const result = await repo.removeCascade(999)

    expect(result).toBeNull()
    expect(fakeManager.delete).not.toHaveBeenCalled()
  })

  it('removeCascade deletes the attachment rows and the entry row in one transaction, returning the deleted attachments', async () => {
    const { ormRepo, fakeManager } = makeRepoMock()
    const entry = fakeEntry({ id: 1 })
    const attachments = [fakeAttachment({ id: 10 }), fakeAttachment({ id: 11 })]
    fakeManager.findOneBy.mockResolvedValue(entry)
    fakeManager.findBy.mockResolvedValue(attachments)
    const repo = new EntriesRepository(ormRepo)

    const result = await repo.removeCascade(1)

    expect(ormRepo.manager.transaction).toHaveBeenCalledTimes(1)
    expect(fakeManager.delete).toHaveBeenNthCalledWith(1, expect.anything(), { entryId: 1 })
    expect(fakeManager.delete).toHaveBeenNthCalledWith(2, expect.anything(), 1)
    expect(result).toBe(attachments)
  })

  it('removeCascade succeeds and returns an empty array when the entry has no attachments', async () => {
    const { ormRepo, fakeManager } = makeRepoMock()
    fakeManager.findOneBy.mockResolvedValue(fakeEntry({ id: 1 }))
    fakeManager.findBy.mockResolvedValue([])
    const repo = new EntriesRepository(ormRepo)

    const result = await repo.removeCascade(1)

    expect(result).toEqual([])
    expect(fakeManager.delete).toHaveBeenNthCalledWith(2, expect.anything(), 1)
  })
})

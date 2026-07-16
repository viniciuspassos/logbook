import { IsNull, type Repository } from 'typeorm'
import { EntriesRepository } from './entries.repository'
import type { Entry } from './entry.entity'
import type { Attachment } from '../attachments/attachment.entity'
import type { UpdateEntryDto } from './dto/update-entry.dto'

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
    version: 1,
    supersededEdits: null,
    deletedAt: null,
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
    merge: jest.fn(),
    save: jest.fn(),
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
  it('findAll delegates to the underlying repository, newest first, filtering tombstoned entries', async () => {
    const { ormRepo } = makeRepoMock()
    const entries = [fakeEntry({ id: 2 }), fakeEntry({ id: 1 })]
    ormRepo.find.mockResolvedValue(entries)
    const repo = new EntriesRepository(ormRepo)

    const result = await repo.findAll()

    expect(ormRepo.find).toHaveBeenCalledWith({
      where: { deletedAt: IsNull() },
      order: { id: 'DESC' },
    })
    expect(result).toBe(entries)
  })

  it('findById returns the entry when found and not tombstoned', async () => {
    const { ormRepo } = makeRepoMock()
    const entry = fakeEntry()
    ormRepo.findOneBy.mockResolvedValue(entry)
    const repo = new EntriesRepository(ormRepo)

    const result = await repo.findById(1)

    expect(ormRepo.findOneBy).toHaveBeenCalledWith({ id: 1, deletedAt: IsNull() })
    expect(result).toBe(entry)
  })

  it('findById returns null when not found', async () => {
    const { ormRepo } = makeRepoMock()
    ormRepo.findOneBy.mockResolvedValue(null)
    const repo = new EntriesRepository(ormRepo)

    const result = await repo.findById(999)

    expect(result).toBeNull()
  })

  it('create builds and saves a new entity starting at version 1 with no tombstone/conflict history', async () => {
    const { ormRepo } = makeRepoMock()
    const draft = fakeEntry({ id: undefined as unknown as number })
    const saved = fakeEntry({ id: 5 })
    ormRepo.create.mockReturnValue(draft)
    ormRepo.save.mockResolvedValue(saved)
    const repo = new EntriesRepository(ormRepo)

    const result = await repo.create({ title: 'x' } as unknown as Entry)

    expect(ormRepo.create).toHaveBeenCalledWith({
      title: 'x',
      version: 1,
      deletedAt: null,
      supersededEdits: null,
    })
    expect(ormRepo.save).toHaveBeenCalledWith(draft)
    expect(result).toBe(saved)
  })

  describe('update', () => {
    function fakeDto(overrides: Partial<UpdateEntryDto> = {}): UpdateEntryDto {
      return { version: 1, ...overrides } as UpdateEntryDto
    }

    it('returns not-found when the entry does not exist (or is tombstoned)', async () => {
      const { ormRepo, fakeManager } = makeRepoMock()
      fakeManager.findOneBy.mockResolvedValue(null)
      const repo = new EntriesRepository(ormRepo)

      const result = await repo.update(999, fakeDto())

      expect(fakeManager.findOneBy).toHaveBeenCalledWith(expect.anything(), {
        id: 999,
        deletedAt: IsNull(),
      })
      expect(result).toEqual({ outcome: 'not-found' })
      expect(fakeManager.save).not.toHaveBeenCalled()
    })

    it('returns a conflict with the current entry, and does not write, when the version is stale', async () => {
      const { ormRepo, fakeManager } = makeRepoMock()
      const current = fakeEntry({ id: 1, version: 5, title: 'Server-side title' })
      fakeManager.findOneBy.mockResolvedValue(current)
      const repo = new EntriesRepository(ormRepo)

      const result = await repo.update(1, fakeDto({ version: 3, title: 'Stale local edit' }))

      expect(result).toEqual({ outcome: 'conflict', current })
      expect(fakeManager.merge).not.toHaveBeenCalled()
      expect(fakeManager.save).not.toHaveBeenCalled()
    })

    it('applies the change and increments the version when the version matches', async () => {
      const { ormRepo, fakeManager } = makeRepoMock()
      const existing = fakeEntry({ id: 1, version: 3, title: 'Old title' })
      const merged = fakeEntry({ id: 1, version: 3, title: 'New title' })
      const saved = fakeEntry({ id: 1, version: 4, title: 'New title' })
      fakeManager.findOneBy.mockResolvedValue(existing)
      fakeManager.merge.mockReturnValue(merged)
      fakeManager.save.mockResolvedValue(saved)
      const repo = new EntriesRepository(ormRepo)

      const result = await repo.update(1, fakeDto({ version: 3, title: 'New title' }))

      expect(fakeManager.merge).toHaveBeenCalledWith(expect.anything(), existing, {
        title: 'New title',
      })
      // The version bump happens on the merged draft, not by trusting the
      // client — save is called with version incremented past `existing`'s.
      expect(fakeManager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ version: 4 }),
      )
      expect(result).toEqual({ outcome: 'updated', entry: saved })
    })

    it('does not forward version or supersededEdit into the merged entity changes', async () => {
      const { ormRepo, fakeManager } = makeRepoMock()
      const existing = fakeEntry({ id: 1, version: 1 })
      fakeManager.findOneBy.mockResolvedValue(existing)
      fakeManager.merge.mockReturnValue(fakeEntry({ id: 1, version: 1 }))
      fakeManager.save.mockResolvedValue(fakeEntry({ id: 1, version: 2 }))
      const repo = new EntriesRepository(ormRepo)

      await repo.update(
        1,
        fakeDto({ version: 1, title: 'x', supersededEdit: { title: 'loser' } }),
      )

      expect(fakeManager.merge).toHaveBeenCalledWith(expect.anything(), existing, {
        title: 'x',
      })
    })

    it('appends a supersededEdit to supersededEdits (preserving the loser) rather than inventing its own merge', async () => {
      const { ormRepo, fakeManager } = makeRepoMock()
      const existing = fakeEntry({ id: 1, version: 3, supersededEdits: null })
      const merged = fakeEntry({ id: 1, version: 3 })
      fakeManager.findOneBy.mockResolvedValue(existing)
      fakeManager.merge.mockReturnValue(merged)
      fakeManager.save.mockImplementation(
        (_target: unknown, entity: Entry) => Promise.resolve(entity),
      )
      const repo = new EntriesRepository(ormRepo)

      const result = await repo.update(
        1,
        fakeDto({ version: 3, title: 'Winning title', supersededEdit: { title: 'Losing title' } }),
      )

      expect(result.outcome).toBe('updated')
      const savedArg = fakeManager.save.mock.calls[0][1] as Entry
      expect(savedArg.supersededEdits).toEqual([
        {
          version: 3,
          capturedAt: expect.any(String),
          data: { title: 'Losing title' },
        },
      ])
    })

    it('appends to (rather than overwrites) an existing supersededEdits history', async () => {
      const { ormRepo, fakeManager } = makeRepoMock()
      const priorLoser = { version: 1, capturedAt: '2026-01-01T00:00:00.000Z', data: { title: 'older loser' } }
      const existing = fakeEntry({ id: 1, version: 2, supersededEdits: [priorLoser] })
      fakeManager.findOneBy.mockResolvedValue(existing)
      fakeManager.merge.mockReturnValue(fakeEntry({ id: 1, version: 2 }))
      fakeManager.save.mockImplementation(
        (_target: unknown, entity: Entry) => Promise.resolve(entity),
      )
      const repo = new EntriesRepository(ormRepo)

      await repo.update(
        1,
        fakeDto({ version: 2, supersededEdit: { title: 'newer loser' } }),
      )

      const savedArg = fakeManager.save.mock.calls[0][1] as Entry
      expect(savedArg.supersededEdits).toHaveLength(2)
      expect(savedArg.supersededEdits?.[0]).toBe(priorLoser)
      expect(savedArg.supersededEdits?.[1]).toMatchObject({ data: { title: 'newer loser' } })
    })

    it('records the loser\'s pre-write version even when merge() mutates-and-returns the same object reference as `existing` (real TypeORM behaviour)', async () => {
      // Regression test: TypeORM's real EntityManager.merge() mutates
      // `mergeIntoEntity` in place and returns that same reference, rather
      // than a fresh object — the earlier mocks above (a plain
      // `mockReturnValue`) don't reproduce that aliasing, so this test
      // simulates it explicitly. Reading `existing.version` *after*
      // `merged.version` is bumped would silently pick up the already
      // -incremented value if the repository didn't capture the base
      // version before merging.
      const { ormRepo, fakeManager } = makeRepoMock()
      const existing = fakeEntry({ id: 1, version: 2, supersededEdits: null })
      fakeManager.findOneBy.mockResolvedValue(existing)
      fakeManager.merge.mockImplementation((_target: unknown, mergeInto: Entry) => mergeInto)
      fakeManager.save.mockImplementation(
        (_target: unknown, entity: Entry) => Promise.resolve(entity),
      )
      const repo = new EntriesRepository(ormRepo)

      const result = await repo.update(
        1,
        fakeDto({ version: 2, title: 'Winning title', supersededEdit: { title: 'Losing title' } }),
      )

      expect(result).toEqual({
        outcome: 'updated',
        entry: expect.objectContaining({ version: 3 }),
      })
      const savedArg = fakeManager.save.mock.calls[0][1] as Entry
      expect(savedArg.supersededEdits).toEqual([
        { version: 2, capturedAt: expect.any(String), data: { title: 'Losing title' } },
      ])
    })

    it('leaves supersededEdits untouched when no supersededEdit is provided', async () => {
      const { ormRepo, fakeManager } = makeRepoMock()
      const existing = fakeEntry({ id: 1, version: 1, supersededEdits: null })
      fakeManager.findOneBy.mockResolvedValue(existing)
      fakeManager.merge.mockReturnValue(fakeEntry({ id: 1, version: 1 }))
      fakeManager.save.mockImplementation(
        (_target: unknown, entity: Entry) => Promise.resolve(entity),
      )
      const repo = new EntriesRepository(ormRepo)

      await repo.update(1, fakeDto({ version: 1, title: 'x' }))

      const savedArg = fakeManager.save.mock.calls[0][1] as Entry
      expect(savedArg.supersededEdits).toBeNull()
    })
  })

  // NOTE: the old plain `remove(id)` method (delete-the-entry-row-only) was
  // replaced by `removeCascade` below as part of #20's cascade-delete
  // decision — there is no longer a code path that deletes an Entry without
  // also cascading to its Attachments, so the old method and its two tests
  // ("remove returns true/false") were removed rather than kept alongside
  // dead code. Their behaviour (row deleted -> truthy result, missing row ->
  // falsy/null result) is fully covered by the removeCascade tests below.

  describe('removeCascade', () => {
    // Behavior change (#24): removeCascade no longer hard-deletes the Entry
    // row — tombstones (`deletedAt`) require it to survive. Attachment rows
    // are still hard-deleted (attachments have no version/update path, so
    // the resurrection failure mode tombstones exist to prevent can't occur
    // for them — see the PR description for the full reasoning), and the
    // caller still cleans up their files best-effort afterwards, unchanged.

    it('returns null without deleting or tombstoning anything when the entry does not exist (or is already tombstoned)', async () => {
      const { ormRepo, fakeManager } = makeRepoMock()
      fakeManager.findOneBy.mockResolvedValue(null)
      const repo = new EntriesRepository(ormRepo)

      const result = await repo.removeCascade(999)

      expect(fakeManager.findOneBy).toHaveBeenCalledWith(expect.anything(), {
        id: 999,
        deletedAt: IsNull(),
      })
      expect(result).toBeNull()
      expect(fakeManager.delete).not.toHaveBeenCalled()
      expect(fakeManager.save).not.toHaveBeenCalled()
    })

    it('hard-deletes the attachment rows, tombstones the entry row (not a hard delete) in one transaction, and returns the deleted attachments', async () => {
      const { ormRepo, fakeManager } = makeRepoMock()
      const entry = fakeEntry({ id: 1, deletedAt: null })
      const attachments = [fakeAttachment({ id: 10 }), fakeAttachment({ id: 11 })]
      fakeManager.findOneBy.mockResolvedValue(entry)
      fakeManager.findBy.mockResolvedValue(attachments)
      fakeManager.save.mockImplementation(
        (_target: unknown, saved: Entry) => Promise.resolve(saved),
      )
      const repo = new EntriesRepository(ormRepo)

      const result = await repo.removeCascade(1)

      expect(ormRepo.manager.transaction).toHaveBeenCalledTimes(1)
      expect(fakeManager.delete).toHaveBeenCalledWith(expect.anything(), { entryId: 1 })
      // The entry row is never passed to manager.delete — only tombstoned.
      expect(fakeManager.delete).toHaveBeenCalledTimes(1)
      expect(fakeManager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 1, deletedAt: expect.any(Date) }),
      )
      expect(result).toBe(attachments)
    })

    it('succeeds and returns an empty array when the entry has no attachments', async () => {
      const { ormRepo, fakeManager } = makeRepoMock()
      fakeManager.findOneBy.mockResolvedValue(fakeEntry({ id: 1 }))
      fakeManager.findBy.mockResolvedValue([])
      fakeManager.save.mockImplementation(
        (_target: unknown, saved: Entry) => Promise.resolve(saved),
      )
      const repo = new EntriesRepository(ormRepo)

      const result = await repo.removeCascade(1)

      expect(result).toEqual([])
      expect(fakeManager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ deletedAt: expect.any(Date) }),
      )
    })
  })
})

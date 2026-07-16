import { DataSource, IsNull, type Repository } from 'typeorm'
import { EntriesRepository } from './entries.repository'
import { Entry } from './entry.entity'
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
    findOneByOrFail: jest.fn(),
    findBy: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
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
    // Behavior change: `update()` no longer writes via read-merge-save
    // (`manager.merge` + `manager.save`) — it now issues a **conditional**
    // `manager.update(Entry, { id, version, deletedAt: IsNull() }, changes)`
    // guarded on the base version, followed by a re-read. See the
    // docstring on EntriesRepository.update for why: a plain
    // read-then-save inside a transaction is not atomic against a
    // concurrent writer under Postgres's default READ COMMITTED isolation.
    // Every test below that used to assert on `manager.merge`/`manager.save`
    // calls is rewritten to assert on the `manager.update` call instead —
    // the behavior each one guards (client-supplied version never trusted
    // for the bump, `version`/`supersededEdit` not forwarded as raw column
    // changes, the loser appended to `supersededEdits` rather than
    // overwriting it) is unchanged, only the mechanism moved.
    //
    // The one test this removes outright rather than rewrites is the old
    // "records the loser's pre-write version even when merge() mutates the
    // same object reference as `existing`" regression test: that risk was
    // specific to `manager.merge()` mutating its `mergeIntoEntity` argument
    // in place, and `merge()` is no longer called anywhere in `update()` —
    // there is no longer a mechanism left for that aliasing bug to occur
    // through. The behavior it protected (the loser's recorded version must
    // be the *base* version, not a post-bump one) is still asserted below,
    // just without needing a mutation-aliasing simulation to do it, since
    // the new code reads `baseVersion` once from a `const` and never
    // mutates `existing` at all.
    function fakeDto(overrides: Partial<UpdateEntryDto> = {}): UpdateEntryDto {
      return { version: 1, ...overrides } as UpdateEntryDto
    }
    function fakeUpdateResult(affected: number) {
      return { affected, raw: {}, generatedMaps: [] }
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
      expect(fakeManager.update).not.toHaveBeenCalled()
    })

    it('returns a conflict with the current entry, and does not write, when the initial read already shows a stale version', async () => {
      const { ormRepo, fakeManager } = makeRepoMock()
      const current = fakeEntry({ id: 1, version: 5, title: 'Server-side title' })
      fakeManager.findOneBy.mockResolvedValue(current)
      const repo = new EntriesRepository(ormRepo)

      const result = await repo.update(1, fakeDto({ version: 3, title: 'Stale local edit' }))

      expect(result).toEqual({ outcome: 'conflict', current })
      expect(fakeManager.update).not.toHaveBeenCalled()
    })

    it('issues a conditional UPDATE guarded on id/version/deletedAt, bumps the version, and returns the re-read row', async () => {
      const { ormRepo, fakeManager } = makeRepoMock()
      const existing = fakeEntry({ id: 1, version: 3, title: 'Old title' })
      const reread = fakeEntry({ id: 1, version: 4, title: 'New title' })
      fakeManager.findOneBy.mockResolvedValue(existing)
      fakeManager.update.mockResolvedValue(fakeUpdateResult(1))
      fakeManager.findOneByOrFail.mockResolvedValue(reread)
      const repo = new EntriesRepository(ormRepo)

      const result = await repo.update(1, fakeDto({ version: 3, title: 'New title' }))

      expect(fakeManager.update).toHaveBeenCalledWith(
        expect.anything(),
        { id: 1, version: 3, deletedAt: IsNull() },
        expect.objectContaining({ title: 'New title', version: 4 }),
      )
      expect(fakeManager.findOneByOrFail).toHaveBeenCalledWith(expect.anything(), { id: 1 })
      expect(result).toEqual({ outcome: 'updated', entry: reread })
    })

    it('does not forward version or supersededEdit as their own keys into the conditional UPDATE\'s column changes', async () => {
      const { ormRepo, fakeManager } = makeRepoMock()
      const existing = fakeEntry({ id: 1, version: 1 })
      fakeManager.findOneBy.mockResolvedValue(existing)
      fakeManager.update.mockResolvedValue(fakeUpdateResult(1))
      fakeManager.findOneByOrFail.mockResolvedValue(fakeEntry({ id: 1, version: 2 }))
      const repo = new EntriesRepository(ormRepo)

      await repo.update(
        1,
        fakeDto({ version: 1, title: 'x', supersededEdit: { title: 'loser' } }),
      )

      const columnChanges = fakeManager.update.mock.calls[0][2] as Record<string, unknown>
      expect(columnChanges).not.toHaveProperty('supersededEdit')
      expect(columnChanges.title).toBe('x')
      // The bump is computed server-side from the row's own base version,
      // never taken from (or equal to only because it echoes) the client's
      // submitted `version` field.
      expect(columnChanges.version).toBe(2)
    })

    it('appends a supersededEdit to supersededEdits (preserving the loser) in the UPDATE payload, rather than inventing its own merge', async () => {
      const { ormRepo, fakeManager } = makeRepoMock()
      const existing = fakeEntry({ id: 1, version: 3, supersededEdits: null })
      fakeManager.findOneBy.mockResolvedValue(existing)
      fakeManager.update.mockResolvedValue(fakeUpdateResult(1))
      fakeManager.findOneByOrFail.mockResolvedValue(fakeEntry({ id: 1, version: 4 }))
      const repo = new EntriesRepository(ormRepo)

      const result = await repo.update(
        1,
        fakeDto({ version: 3, title: 'Winning title', supersededEdit: { title: 'Losing title' } }),
      )

      expect(result.outcome).toBe('updated')
      const columnChanges = fakeManager.update.mock.calls[0][2] as {
        supersededEdits: unknown
      }
      expect(columnChanges.supersededEdits).toEqual([
        {
          // The base version this loser conflicted with — not the bumped
          // version being written in this same call.
          version: 3,
          capturedAt: expect.any(String),
          data: { title: 'Losing title' },
        },
      ])
    })

    it('appends to (rather than overwrites) an existing supersededEdits history', async () => {
      const { ormRepo, fakeManager } = makeRepoMock()
      const priorLoser = {
        version: 1,
        capturedAt: '2026-01-01T00:00:00.000Z',
        data: { title: 'older loser' },
      }
      const existing = fakeEntry({ id: 1, version: 2, supersededEdits: [priorLoser] })
      fakeManager.findOneBy.mockResolvedValue(existing)
      fakeManager.update.mockResolvedValue(fakeUpdateResult(1))
      fakeManager.findOneByOrFail.mockResolvedValue(fakeEntry({ id: 1, version: 3 }))
      const repo = new EntriesRepository(ormRepo)

      await repo.update(1, fakeDto({ version: 2, supersededEdit: { title: 'newer loser' } }))

      const columnChanges = fakeManager.update.mock.calls[0][2] as {
        supersededEdits: unknown[]
      }
      expect(columnChanges.supersededEdits).toHaveLength(2)
      expect(columnChanges.supersededEdits[0]).toBe(priorLoser)
      expect(columnChanges.supersededEdits[1]).toMatchObject({ data: { title: 'newer loser' } })
    })

    it('leaves supersededEdits out of the UPDATE payload entirely when no supersededEdit is provided', async () => {
      const { ormRepo, fakeManager } = makeRepoMock()
      const existing = fakeEntry({ id: 1, version: 1, supersededEdits: null })
      fakeManager.findOneBy.mockResolvedValue(existing)
      fakeManager.update.mockResolvedValue(fakeUpdateResult(1))
      fakeManager.findOneByOrFail.mockResolvedValue(fakeEntry({ id: 1, version: 2 }))
      const repo = new EntriesRepository(ormRepo)

      await repo.update(1, fakeDto({ version: 1, title: 'x' }))

      const columnChanges = fakeManager.update.mock.calls[0][2] as Record<string, unknown>
      expect(columnChanges).not.toHaveProperty('supersededEdits')
    })

    it('re-reads and returns conflict — not updated — when the conditional UPDATE affects zero rows because a racing writer already changed the version', async () => {
      // This is the race-guard branch: the initial read matched the
      // submitted version, but by the time the conditional UPDATE actually
      // executed, something else had already changed the row (the literal
      // scenario a transaction alone does not prevent — see the docstring
      // on EntriesRepository.update). This test proves the repository's own
      // control flow given that outcome; the sqljs-backed describe block
      // below proves the driver itself reports affected=0 in exactly this
      // situation — mocks alone can't prove that half.
      const { ormRepo, fakeManager } = makeRepoMock()
      const existing = fakeEntry({ id: 1, version: 3 })
      const racedCurrent = fakeEntry({ id: 1, version: 4, title: 'Racing writer won' })
      fakeManager.findOneBy
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(racedCurrent)
      fakeManager.update.mockResolvedValue(fakeUpdateResult(0))
      const repo = new EntriesRepository(ormRepo)

      const result = await repo.update(1, fakeDto({ version: 3, title: 'Stale write' }))

      expect(result).toEqual({ outcome: 'conflict', current: racedCurrent })
      expect(fakeManager.findOneByOrFail).not.toHaveBeenCalled()
    })

    it('re-reads and returns not-found when the conditional UPDATE affects zero rows because a racing writer tombstoned the entry', async () => {
      const { ormRepo, fakeManager } = makeRepoMock()
      const existing = fakeEntry({ id: 1, version: 3 })
      const tombstoned = fakeEntry({ id: 1, version: 3, deletedAt: new Date() })
      fakeManager.findOneBy
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(tombstoned)
      fakeManager.update.mockResolvedValue(fakeUpdateResult(0))
      const repo = new EntriesRepository(ormRepo)

      const result = await repo.update(1, fakeDto({ version: 3, title: 'Stale write' }))

      expect(result).toEqual({ outcome: 'not-found' })
    })
  })

  describe('update — conditional-UPDATE affected-rows semantics (real sqljs driver)', () => {
    // Every test above mocks `manager.update`'s return value — appropriate
    // for proving this repository's own control flow, but it can't prove
    // the one fact that whole race-guard mechanism actually depends on:
    // that TypeORM's conditional `UPDATE ... WHERE version = :baseVersion`
    // really does affect zero rows once that predicate stops matching,
    // *on the same sqljs driver this app's own test suite runs against*
    // (see jest.config.js — the e2e suites use `type: 'sqljs'`, not
    // Postgres). A mocked `manager.update` would just echo back whatever
    // `affected` value a test hands it either way, so this is exercised
    // against a real sqljs-backed DataSource instead, per the same
    // "don't trust an unverified assumption about TypeORM" lesson the
    // merge()-mutation bug earlier in this file already taught once.
    let dataSource: DataSource

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'sqljs',
        autoSave: false,
        synchronize: true,
        entities: [Entry],
      })
      await dataSource.initialize()
    })

    afterAll(async () => {
      await dataSource.destroy()
    })

    it('affects exactly the one row matching WHERE id/version, and zero rows once that version is stale', async () => {
      const repo = new EntriesRepository(dataSource.getRepository(Entry))
      const created = await repo.create(fakeEntry({ id: undefined as unknown as number }))
      expect(created.version).toBe(1)

      const winning = await dataSource.manager.update(
        Entry,
        { id: created.id, version: 1 },
        { title: 'winner', version: 2 },
      )
      expect(winning.affected).toBe(1)

      // Same predicate as above (WHERE version = 1), now stale: this is
      // exactly the query EntriesRepository.update() would issue for a
      // second writer racing on the row's original, pre-write version.
      const losing = await dataSource.manager.update(
        Entry,
        { id: created.id, version: 1 },
        { title: 'loser', version: 2 },
      )
      expect(losing.affected).toBe(0)
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

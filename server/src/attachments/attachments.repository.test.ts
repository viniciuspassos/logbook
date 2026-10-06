import { DataSource, type Repository } from 'typeorm'
import { Entry } from '../entries/entry.entity'
import { User } from '../users/user.entity'
import { AttachmentsRepository } from './attachments.repository'
import { Attachment } from './attachment.entity'

function fakeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 1,
    entryId: 10,
    originalFilename: 'summit.jpg',
    storageKey: 'uuid-summit.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1234,
    createdAt: new Date(),
    ...overrides,
  }
}

function makeOrmMock() {
  return {
    create: jest.fn(),
    save: jest.fn(),
  } as unknown as jest.Mocked<Repository<Attachment>>
}

describe('AttachmentsRepository', () => {
  it('create builds and saves a new attachment row', async () => {
    const ormRepo = makeOrmMock()
    const draft = fakeAttachment({ id: undefined as unknown as number })
    const saved = fakeAttachment({ id: 7 })
    ormRepo.create.mockReturnValue(draft)
    ormRepo.save.mockResolvedValue(saved)
    const repo = new AttachmentsRepository(ormRepo)

    const input = { entryId: 10 } as unknown as Attachment
    const result = await repo.create(input)

    expect(ormRepo.create).toHaveBeenCalledWith(input)
    expect(ormRepo.save).toHaveBeenCalledWith(draft)
    expect(result).toBe(saved)
  })

  // Ownership is resolved through the parent entry's owner, not the
  // attachment's own (nullable) userId, so these run against a real sqljs
  // schema: a mocked query builder could not prove the join.
  describe('ownership follows the parent entry (real sqljs driver)', () => {
    let dataSource: DataSource
    let repo: AttachmentsRepository
    let owner: User
    let other: User
    let entryId: number
    let ownedWithUserId: Attachment
    let ownedWithNullUserId: Attachment

    function entryFor(userId: number): Partial<Entry> {
      return {
        title: 't',
        shape: 'circle',
        location: 'l',
        date: 'd',
        metric: 'm',
        excerpt: 'e',
        weather: 'w',
        duration: 'du',
        difficulty: 'di',
        equipment: 'eq',
        participants: 'p',
        raw: 'r',
        story: 's',
        photoHint: 'h',
        media: ['a', 'b', 'c'],
        mapX: 1,
        mapY: 2,
        userId,
      }
    }

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'sqljs',
        autoSave: false,
        synchronize: true,
        entities: [Entry, Attachment, User],
      })
      await dataSource.initialize()
      repo = new AttachmentsRepository(dataSource.getRepository(Attachment))

      const users = dataSource.getRepository(User)
      owner = await users.save(
        users.create({ googleSub: 'o', email: 'o@example.com', name: null, picture: null }),
      )
      other = await users.save(
        users.create({ googleSub: 'x', email: 'x@example.com', name: null, picture: null }),
      )
      const entries = dataSource.getRepository(Entry)
      const entry = await entries.save(entries.create(entryFor(owner.id)))
      entryId = entry.id

      const attachments = dataSource.getRepository(Attachment)
      const base = {
        entryId,
        originalFilename: 'a.jpg',
        storageKey: 'k',
        mimeType: 'image/jpeg',
        sizeBytes: 1,
      }
      ownedWithUserId = await attachments.save(attachments.create({ ...base, userId: owner.id }))
      // A legacy row whose own userId was never set, under an owned entry.
      ownedWithNullUserId = await attachments.save(attachments.create({ ...base, userId: null }))
    })

    afterAll(async () => {
      await dataSource.destroy()
    })

    it("findByEntryId returns every attachment of the owner's entry, newest first, including one with a NULL userId", async () => {
      const result = await repo.findByEntryId(entryId, owner.id)

      expect(result.map((a) => a.id)).toEqual([ownedWithNullUserId.id, ownedWithUserId.id])
    })

    it('findByEntryId returns nothing for a user who does not own the entry', async () => {
      await expect(repo.findByEntryId(entryId, other.id)).resolves.toEqual([])
    })

    it('findById finds an attachment (even with a NULL userId) for the entry owner', async () => {
      const found = await repo.findById(ownedWithNullUserId.id, owner.id)

      expect(found?.id).toBe(ownedWithNullUserId.id)
    })

    it('findById returns null for another user, and for an id that does not exist', async () => {
      await expect(repo.findById(ownedWithUserId.id, other.id)).resolves.toBeNull()
      await expect(repo.findById(99999, owner.id)).resolves.toBeNull()
    })

    it('an entry that has been tombstoned hides its attachments from findByEntryId, findById and remove', async () => {
      const entries = dataSource.getRepository(Entry)
      const attachments = dataSource.getRepository(Attachment)
      const deletedEntry = await entries.save(entries.create(entryFor(owner.id)))
      const orphaned = await attachments.save(
        attachments.create({
          entryId: deletedEntry.id,
          originalFilename: 't.jpg',
          storageKey: 'kt',
          mimeType: 'image/jpeg',
          sizeBytes: 1,
          userId: owner.id,
        }),
      )
      await entries.update({ id: deletedEntry.id }, { deletedAt: new Date() })

      await expect(repo.findByEntryId(deletedEntry.id, owner.id)).resolves.toEqual([])
      await expect(repo.findById(orphaned.id, owner.id)).resolves.toBeNull()
      await expect(repo.remove(orphaned.id, owner.id)).resolves.toBe(false)
      await expect(attachments.findOneBy({ id: orphaned.id })).resolves.not.toBeNull()
    })

    it('remove returns false and deletes nothing for another user', async () => {
      await expect(repo.remove(ownedWithUserId.id, other.id)).resolves.toBe(false)

      await expect(repo.findById(ownedWithUserId.id, owner.id)).resolves.not.toBeNull()
    })

    it('remove is one scoped DELETE: ownership is folded into the statement, with no separate lookup first', async () => {
      const findByIdSpy = jest.spyOn(repo, 'findById')
      const attachments = dataSource.getRepository(Attachment)
      const doomed = await attachments.save(
        attachments.create({
          entryId,
          originalFilename: 'd.jpg',
          storageKey: 'kd',
          mimeType: 'image/jpeg',
          sizeBytes: 1,
          userId: null,
        }),
      )

      await expect(repo.remove(doomed.id, other.id)).resolves.toBe(false)
      await expect(attachments.findOneBy({ id: doomed.id })).resolves.not.toBeNull()
      await expect(repo.remove(doomed.id, owner.id)).resolves.toBe(true)
      await expect(attachments.findOneBy({ id: doomed.id })).resolves.toBeNull()

      expect(findByIdSpy).not.toHaveBeenCalled()
      findByIdSpy.mockRestore()
    })

    it('remove deletes the attachment for the entry owner and reports true', async () => {
      await expect(repo.remove(ownedWithNullUserId.id, owner.id)).resolves.toBe(true)

      await expect(repo.findById(ownedWithNullUserId.id, owner.id)).resolves.toBeNull()
    })
  })
})

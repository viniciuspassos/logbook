import { DataSource, IsNull, type Repository } from 'typeorm'
import { Attachment } from '../attachments/attachment.entity'
import { Entry } from '../entries/entry.entity'
import { User } from './user.entity'
import { UsersRepository } from './users.repository'

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    googleSub: 'sub-1',
    email: 'me@example.com',
    name: 'Me',
    picture: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeFakeManager(driver: string) {
  return {
    connection: { options: { type: driver } },
    query: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  }
}

function makeRepoMock(driver = 'postgres') {
  const fakeManager = makeFakeManager(driver)
  const ormRepo = {
    findOneBy: jest.fn(),
    update: jest.fn(),
    manager: {
      transaction: jest.fn(
        (cb: (manager: typeof fakeManager) => Promise<unknown>) => cb(fakeManager),
      ),
    },
  } as unknown as jest.Mocked<Repository<User>> & { manager: { transaction: jest.Mock } }
  return { ormRepo, fakeManager }
}

describe('UsersRepository', () => {
  it('findByGoogleSub looks the user up by the sub column', async () => {
    const { ormRepo } = makeRepoMock()
    const user = fakeUser()
    ormRepo.findOneBy.mockResolvedValue(user)
    const repo = new UsersRepository(ormRepo)

    await expect(repo.findByGoogleSub('sub-1')).resolves.toBe(user)
    expect(ormRepo.findOneBy).toHaveBeenCalledWith({ googleSub: 'sub-1' })
  })

  it('findById returns null when there is no such user', async () => {
    const { ormRepo } = makeRepoMock()
    ormRepo.findOneBy.mockResolvedValue(null)
    const repo = new UsersRepository(ormRepo)

    await expect(repo.findById(99)).resolves.toBeNull()
    expect(ormRepo.findOneBy).toHaveBeenCalledWith({ id: 99 })
  })

  it('updateProfile writes only the profile snapshot columns', async () => {
    const { ormRepo } = makeRepoMock()
    const repo = new UsersRepository(ormRepo)

    await repo.updateProfile(1, { email: 'new@example.com', name: null, picture: 'p' })

    expect(ormRepo.update).toHaveBeenCalledWith(1, {
      email: 'new@example.com',
      name: null,
      picture: 'p',
    })
  })

  describe('findOrCreateClaimingLegacyRowsIfFirst', () => {
    const profile = { googleSub: 'sub-1', email: 'me@example.com', name: 'Me', picture: null }

    it('takes the advisory lock first on Postgres, then creates the user and claims every ownerless entry and attachment when they are the first user', async () => {
      const { ormRepo, fakeManager } = makeRepoMock('postgres')
      const saved = fakeUser({ id: 4 })
      fakeManager.findOneBy.mockResolvedValue(null)
      fakeManager.count.mockResolvedValue(0)
      fakeManager.create.mockReturnValue(profile)
      fakeManager.save.mockResolvedValue(saved)
      const repo = new UsersRepository(ormRepo)

      const result = await repo.findOrCreateClaimingLegacyRowsIfFirst(profile)

      expect(ormRepo.manager.transaction).toHaveBeenCalledTimes(1)
      expect(fakeManager.query).toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_xact_lock'),
        [expect.any(Number)],
      )
      expect(fakeManager.query.mock.invocationCallOrder[0]).toBeLessThan(
        fakeManager.findOneBy.mock.invocationCallOrder[0],
      )
      expect(fakeManager.create).toHaveBeenCalledWith(User, profile)
      expect(fakeManager.update).toHaveBeenCalledWith(Entry, { userId: IsNull() }, { userId: 4 })
      expect(fakeManager.update).toHaveBeenCalledWith(
        Attachment,
        { userId: IsNull() },
        { userId: 4 },
      )
      expect(result).toBe(saved)
    })

    it('does not take the Postgres advisory lock on other drivers (sql.js in tests)', async () => {
      const { ormRepo, fakeManager } = makeRepoMock('sqljs')
      fakeManager.findOneBy.mockResolvedValue(null)
      fakeManager.count.mockResolvedValue(0)
      fakeManager.create.mockReturnValue(profile)
      fakeManager.save.mockResolvedValue(fakeUser())
      const repo = new UsersRepository(ormRepo)

      await repo.findOrCreateClaimingLegacyRowsIfFirst(profile)

      expect(fakeManager.query).not.toHaveBeenCalled()
    })

    it('creates the user without touching existing rows when another user already exists', async () => {
      const { ormRepo, fakeManager } = makeRepoMock()
      const saved = fakeUser({ id: 5 })
      fakeManager.findOneBy.mockResolvedValue(null)
      fakeManager.count.mockResolvedValue(1)
      fakeManager.create.mockReturnValue(profile)
      fakeManager.save.mockResolvedValue(saved)
      const repo = new UsersRepository(ormRepo)

      const result = await repo.findOrCreateClaimingLegacyRowsIfFirst(profile)

      expect(fakeManager.update).not.toHaveBeenCalled()
      expect(result).toBe(saved)
    })

    it('is idempotent: when the sub already exists under the lock (a racing sign-in won), it returns that user without inserting or claiming', async () => {
      const { ormRepo, fakeManager } = makeRepoMock()
      const existing = fakeUser({ id: 2 })
      fakeManager.findOneBy.mockResolvedValue(existing)
      const repo = new UsersRepository(ormRepo)

      const result = await repo.findOrCreateClaimingLegacyRowsIfFirst(profile)

      expect(fakeManager.findOneBy).toHaveBeenCalledWith(User, { googleSub: 'sub-1' })
      expect(result).toBe(existing)
      expect(fakeManager.save).not.toHaveBeenCalled()
      expect(fakeManager.update).not.toHaveBeenCalled()
    })
  })

  describe('findOrCreateClaimingLegacyRowsIfFirst (real sqljs driver)', () => {
    let dataSource: DataSource

    beforeEach(async () => {
      dataSource = new DataSource({
        type: 'sqljs',
        autoSave: false,
        synchronize: true,
        entities: [Entry, Attachment, User],
      })
      await dataSource.initialize()
    })

    afterEach(async () => {
      await dataSource.destroy()
    })

    it('claims legacy rows for the first user only; a second user and a repeat call neither claim nor duplicate', async () => {
      const entries = dataSource.getRepository(Entry)
      const orphan = await entries.save(
        entries.create({
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
          userId: null,
        }),
      )
      const repo = new UsersRepository(dataSource.getRepository(User))
      const base = { email: 'a@example.com', name: null, picture: null }

      const first = await repo.findOrCreateClaimingLegacyRowsIfFirst({ ...base, googleSub: 'a' })
      const again = await repo.findOrCreateClaimingLegacyRowsIfFirst({ ...base, googleSub: 'a' })
      const second = await repo.findOrCreateClaimingLegacyRowsIfFirst({
        ...base,
        email: 'b@example.com',
        googleSub: 'b',
      })

      expect(again.id).toBe(first.id)
      expect(second.id).not.toBe(first.id)
      await expect(dataSource.getRepository(User).count()).resolves.toBe(2)
      await expect(entries.findOneByOrFail({ id: orphan.id })).resolves.toMatchObject({
        userId: first.id,
      })
    })
  })
})

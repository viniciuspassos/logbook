import { IsNull, type Repository } from 'typeorm'
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

function makeFakeManager() {
  return {
    create: jest.fn(),
    save: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  }
}

function makeRepoMock() {
  const fakeManager = makeFakeManager()
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

  describe('createClaimingLegacyRowsIfFirst', () => {
    const profile = { googleSub: 'sub-1', email: 'me@example.com', name: 'Me', picture: null }

    it('creates the user and hands every ownerless entry and attachment to them when they are the first user', async () => {
      const { ormRepo, fakeManager } = makeRepoMock()
      const saved = fakeUser({ id: 4 })
      fakeManager.create.mockReturnValue(profile)
      fakeManager.save.mockResolvedValue(saved)
      fakeManager.count.mockResolvedValue(1)
      const repo = new UsersRepository(ormRepo)

      const result = await repo.createClaimingLegacyRowsIfFirst(profile)

      expect(ormRepo.manager.transaction).toHaveBeenCalledTimes(1)
      expect(fakeManager.create).toHaveBeenCalledWith(User, profile)
      expect(fakeManager.update).toHaveBeenCalledWith(Entry, { userId: IsNull() }, { userId: 4 })
      expect(fakeManager.update).toHaveBeenCalledWith(
        Attachment,
        { userId: IsNull() },
        { userId: 4 },
      )
      expect(result).toBe(saved)
    })

    it('creates the user without touching existing rows when another user already exists', async () => {
      const { ormRepo, fakeManager } = makeRepoMock()
      const saved = fakeUser({ id: 5 })
      fakeManager.create.mockReturnValue(profile)
      fakeManager.save.mockResolvedValue(saved)
      fakeManager.count.mockResolvedValue(2)
      const repo = new UsersRepository(ormRepo)

      const result = await repo.createClaimingLegacyRowsIfFirst(profile)

      expect(fakeManager.update).not.toHaveBeenCalled()
      expect(result).toBe(saved)
    })
  })
})

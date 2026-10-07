import type { Repository } from 'typeorm'
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

function makeRepoMock() {
  return {
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<Repository<User>>
}

describe('UsersRepository', () => {
  it('findById returns null when there is no such user', async () => {
    const ormRepo = makeRepoMock()
    ormRepo.findOneBy.mockResolvedValue(null)
    const repo = new UsersRepository(ormRepo)

    await expect(repo.findById(99)).resolves.toBeNull()
    expect(ormRepo.findOneBy).toHaveBeenCalledWith({ id: 99 })
  })

  it('updateProfile writes only the profile snapshot columns', async () => {
    const ormRepo = makeRepoMock()
    const repo = new UsersRepository(ormRepo)

    await repo.updateProfile(1, { email: 'new@example.com', name: null, picture: 'p' })

    expect(ormRepo.update).toHaveBeenCalledWith(1, {
      email: 'new@example.com',
      name: null,
      picture: 'p',
    })
  })

  describe('findOrCreate', () => {
    const data = { googleSub: 'sub-1', email: 'me@example.com', name: 'Me', picture: null }

    it('returns the existing user, looked up by the sub column, without inserting', async () => {
      const ormRepo = makeRepoMock()
      const existing = fakeUser({ id: 2 })
      ormRepo.findOneBy.mockResolvedValue(existing)
      const repo = new UsersRepository(ormRepo)

      await expect(repo.findOrCreate(data)).resolves.toBe(existing)

      expect(ormRepo.findOneBy).toHaveBeenCalledWith({ googleSub: 'sub-1' })
      expect(ormRepo.save).not.toHaveBeenCalled()
    })

    it('inserts and returns a new user when the sub is unknown', async () => {
      const ormRepo = makeRepoMock()
      const saved = fakeUser({ id: 5 })
      ormRepo.findOneBy.mockResolvedValue(null)
      ormRepo.create.mockReturnValue(data as unknown as User)
      ormRepo.save.mockResolvedValue(saved)
      const repo = new UsersRepository(ormRepo)

      await expect(repo.findOrCreate(data)).resolves.toBe(saved)

      expect(ormRepo.create).toHaveBeenCalledWith(data)
      expect(ormRepo.save).toHaveBeenCalledWith(data)
    })

    it('returns the racer\'s user when the insert loses a concurrent first sign-in to the unique googleSub', async () => {
      const ormRepo = makeRepoMock()
      const racer = fakeUser({ id: 6 })
      ormRepo.findOneBy.mockResolvedValueOnce(null).mockResolvedValueOnce(racer)
      ormRepo.create.mockReturnValue(data as unknown as User)
      ormRepo.save.mockRejectedValue(new Error('duplicate key value violates unique constraint'))
      const repo = new UsersRepository(ormRepo)

      await expect(repo.findOrCreate(data)).resolves.toBe(racer)

      expect(ormRepo.findOneBy).toHaveBeenCalledTimes(2)
    })

    it('rethrows the original insert error when no user exists afterwards (not a race)', async () => {
      const ormRepo = makeRepoMock()
      const failure = new Error('connection lost')
      ormRepo.findOneBy.mockResolvedValue(null)
      ormRepo.create.mockReturnValue(data as unknown as User)
      ormRepo.save.mockRejectedValue(failure)
      const repo = new UsersRepository(ormRepo)

      await expect(repo.findOrCreate(data)).rejects.toBe(failure)
    })
  })
})

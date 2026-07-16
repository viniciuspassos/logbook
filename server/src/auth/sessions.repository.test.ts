import type { Repository } from 'typeorm'
import { SessionsRepository } from './sessions.repository'
import type { Session } from './session.entity'

function fakeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 1,
    tokenHash: 'hash-of-token',
    csrfToken: 'csrf-token',
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
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
    delete: jest.fn(),
  } as unknown as jest.Mocked<Repository<Session>>
}

describe('SessionsRepository', () => {
  it('findByTokenHash returns the session when found', async () => {
    const ormRepo = makeRepoMock()
    const session = fakeSession()
    ormRepo.findOneBy.mockResolvedValue(session)
    const repo = new SessionsRepository(ormRepo)

    const result = await repo.findByTokenHash('hash-of-token')

    expect(ormRepo.findOneBy).toHaveBeenCalledWith({ tokenHash: 'hash-of-token' })
    expect(result).toBe(session)
  })

  it('findByTokenHash returns null when not found', async () => {
    const ormRepo = makeRepoMock()
    ormRepo.findOneBy.mockResolvedValue(null)
    const repo = new SessionsRepository(ormRepo)

    const result = await repo.findByTokenHash('missing')

    expect(result).toBeNull()
  })

  it('create builds and saves a new session row', async () => {
    const ormRepo = makeRepoMock()
    const draft = fakeSession({ id: undefined as unknown as number })
    const saved = fakeSession({ id: 5 })
    ormRepo.create.mockReturnValue(draft)
    ormRepo.save.mockResolvedValue(saved)
    const repo = new SessionsRepository(ormRepo)

    const result = await repo.create({
      tokenHash: 'hash-of-token',
      csrfToken: 'csrf-token',
      expiresAt: saved.expiresAt,
    })

    expect(ormRepo.create).toHaveBeenCalledWith({
      tokenHash: 'hash-of-token',
      csrfToken: 'csrf-token',
      expiresAt: saved.expiresAt,
    })
    expect(ormRepo.save).toHaveBeenCalledWith(draft)
    expect(result).toBe(saved)
  })

  it('updateExpiresAt updates only the expiry column', async () => {
    const ormRepo = makeRepoMock()
    const repo = new SessionsRepository(ormRepo)
    const newExpiry = new Date('2026-09-01T00:00:00.000Z')

    await repo.updateExpiresAt(5, newExpiry)

    expect(ormRepo.update).toHaveBeenCalledWith(5, { expiresAt: newExpiry })
  })

  it('removeById deletes the row', async () => {
    const ormRepo = makeRepoMock()
    const repo = new SessionsRepository(ormRepo)

    await repo.removeById(5)

    expect(ormRepo.delete).toHaveBeenCalledWith(5)
  })

  it('removeByTokenHash deletes by the hash column', async () => {
    const ormRepo = makeRepoMock()
    const repo = new SessionsRepository(ormRepo)

    await repo.removeByTokenHash('hash-of-token')

    expect(ormRepo.delete).toHaveBeenCalledWith({ tokenHash: 'hash-of-token' })
  })
})

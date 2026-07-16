import { SessionsService } from './sessions.service'
import type { SessionsRepository } from './sessions.repository'
import type { Session } from './session.entity'
import { hashToken } from './token.util'

const TTL_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

function fakeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 1,
    tokenHash: 'some-hash',
    csrfToken: 'csrf-token',
    expiresAt: new Date(Date.now() + TTL_DAYS * DAY_MS),
    createdAt: new Date(),
    ...overrides,
  }
}

function makeRepoMock() {
  return {
    findByTokenHash: jest.fn(),
    create: jest.fn(),
    updateExpiresAt: jest.fn(),
    removeById: jest.fn(),
    removeByTokenHash: jest.fn(),
  } as unknown as jest.Mocked<SessionsRepository>
}

describe('SessionsService', () => {
  const NOW = new Date('2026-07-16T12:00:00.000Z')

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('create', () => {
    it('creates a session row with a token hash and an expiry TTL days out', async () => {
      const repo = makeRepoMock()
      const created = fakeSession()
      repo.create.mockResolvedValue(created)
      const service = new SessionsService(repo, { sessionTtlDays: TTL_DAYS })

      const result = await service.create()

      expect(repo.create).toHaveBeenCalledWith({
        tokenHash: hashToken(result.sessionToken),
        csrfToken: result.csrfToken,
        expiresAt: new Date(NOW.getTime() + TTL_DAYS * DAY_MS),
      })
      expect(result.expiresAt).toEqual(new Date(NOW.getTime() + TTL_DAYS * DAY_MS))
      expect(result.sessionToken).toMatch(/^[0-9a-f]{64}$/)
      expect(result.csrfToken).toMatch(/^[0-9a-f]{64}$/)
    })

    it('generates a different session token and csrf token on each call', async () => {
      const repo = makeRepoMock()
      repo.create.mockResolvedValue(fakeSession())
      const service = new SessionsService(repo, { sessionTtlDays: TTL_DAYS })

      const first = await service.create()
      const second = await service.create()

      expect(first.sessionToken).not.toBe(second.sessionToken)
      expect(first.csrfToken).not.toBe(second.csrfToken)
    })
  })

  describe('validate', () => {
    it('returns null when no session matches the token', async () => {
      const repo = makeRepoMock()
      repo.findByTokenHash.mockResolvedValue(null)
      const service = new SessionsService(repo, { sessionTtlDays: TTL_DAYS })

      const result = await service.validate('unknown-token')

      expect(result).toBeNull()
      expect(repo.findByTokenHash).toHaveBeenCalledWith(hashToken('unknown-token'))
    })

    it('returns null and deletes the row when the session has expired', async () => {
      const repo = makeRepoMock()
      const expired = fakeSession({ id: 7, expiresAt: new Date(NOW.getTime() - 1000) })
      repo.findByTokenHash.mockResolvedValue(expired)
      const service = new SessionsService(repo, { sessionTtlDays: TTL_DAYS })

      const result = await service.validate('some-token')

      expect(result).toBeNull()
      expect(repo.removeById).toHaveBeenCalledWith(7)
    })

    it('returns the session unchanged when more than half the TTL remains (no renewal write)', async () => {
      const repo = makeRepoMock()
      // 20 days remaining out of a 30-day TTL — comfortably more than half.
      const session = fakeSession({
        expiresAt: new Date(NOW.getTime() + 20 * DAY_MS),
      })
      repo.findByTokenHash.mockResolvedValue(session)
      const service = new SessionsService(repo, { sessionTtlDays: TTL_DAYS })

      const result = await service.validate('some-token')

      expect(result).toEqual(session)
      expect(repo.updateExpiresAt).not.toHaveBeenCalled()
    })

    it('slides the expiry forward when less than half the TTL remains', async () => {
      const repo = makeRepoMock()
      // 10 days remaining out of a 30-day TTL — less than half, renewal kicks in.
      const session = fakeSession({
        id: 3,
        expiresAt: new Date(NOW.getTime() + 10 * DAY_MS),
      })
      repo.findByTokenHash.mockResolvedValue(session)
      const service = new SessionsService(repo, { sessionTtlDays: TTL_DAYS })

      const result = await service.validate('some-token')

      const expectedNewExpiry = new Date(NOW.getTime() + TTL_DAYS * DAY_MS)
      expect(repo.updateExpiresAt).toHaveBeenCalledWith(3, expectedNewExpiry)
      expect(result?.expiresAt).toEqual(expectedNewExpiry)
    })
  })

  describe('revoke', () => {
    it('deletes the session row matching the token', async () => {
      const repo = makeRepoMock()
      const service = new SessionsService(repo, { sessionTtlDays: TTL_DAYS })

      await service.revoke('some-token')

      expect(repo.removeByTokenHash).toHaveBeenCalledWith(hashToken('some-token'))
    })
  })
})

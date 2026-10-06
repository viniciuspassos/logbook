import type { GoogleIdentity } from '../auth/google-token-verifier.service'
import type { User } from './user.entity'
import type { UsersRepository } from './users.repository'
import { UsersService } from './users.service'

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    googleSub: 'sub-1',
    email: 'me@example.com',
    name: 'Me',
    picture: 'https://example.com/me.png',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  }
}

const identity: GoogleIdentity = {
  sub: 'sub-1',
  email: 'me@example.com',
  name: 'Me',
  picture: 'https://example.com/me.png',
}

function makeRepoMock() {
  return {
    findByGoogleSub: jest.fn(),
    findById: jest.fn(),
    updateProfile: jest.fn(),
    createClaimingLegacyRowsIfFirst: jest.fn(),
  } as unknown as jest.Mocked<UsersRepository>
}

describe('UsersService', () => {
  describe('findOrCreateFromGoogle', () => {
    it('creates a user (claiming legacy rows if first) when the sub is unknown', async () => {
      const repo = makeRepoMock()
      const created = fakeUser({ id: 9 })
      repo.findByGoogleSub.mockResolvedValue(null)
      repo.createClaimingLegacyRowsIfFirst.mockResolvedValue(created)
      const service = new UsersService(repo)

      await expect(service.findOrCreateFromGoogle(identity)).resolves.toBe(created)

      expect(repo.findByGoogleSub).toHaveBeenCalledWith('sub-1')
      expect(repo.createClaimingLegacyRowsIfFirst).toHaveBeenCalledWith({
        googleSub: 'sub-1',
        email: 'me@example.com',
        name: 'Me',
        picture: 'https://example.com/me.png',
      })
    })

    it('returns the existing user without writing when the profile is unchanged', async () => {
      const repo = makeRepoMock()
      const existing = fakeUser()
      repo.findByGoogleSub.mockResolvedValue(existing)
      const service = new UsersService(repo)

      await expect(service.findOrCreateFromGoogle(identity)).resolves.toBe(existing)

      expect(repo.updateProfile).not.toHaveBeenCalled()
      expect(repo.createClaimingLegacyRowsIfFirst).not.toHaveBeenCalled()
    })

    it('refreshes the profile snapshot when e-mail, name or picture changed, matching by sub and never by e-mail', async () => {
      const repo = makeRepoMock()
      repo.findByGoogleSub.mockResolvedValue(fakeUser({ email: 'old@example.com', name: null }))
      const service = new UsersService(repo)

      const result = await service.findOrCreateFromGoogle(identity)

      expect(repo.updateProfile).toHaveBeenCalledWith(1, {
        email: 'me@example.com',
        name: 'Me',
        picture: 'https://example.com/me.png',
      })
      expect(result).toEqual(
        expect.objectContaining({ id: 1, email: 'me@example.com', name: 'Me' }),
      )
    })
  })

  describe('findById', () => {
    it('delegates to the repository', async () => {
      const repo = makeRepoMock()
      const user = fakeUser()
      repo.findById.mockResolvedValue(user)
      const service = new UsersService(repo)

      await expect(service.findById(1)).resolves.toBe(user)
      expect(repo.findById).toHaveBeenCalledWith(1)
    })
  })
})

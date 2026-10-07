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
    findById: jest.fn(),
    updateProfile: jest.fn(),
    findOrCreate: jest.fn(),
  } as unknown as jest.Mocked<UsersRepository>
}

describe('UsersService', () => {
  describe('findOrCreateFromGoogle', () => {
    it('finds or creates the user by Google sub, with the profile from the verified token', async () => {
      const repo = makeRepoMock()
      const user = fakeUser()
      repo.findOrCreate.mockResolvedValue(user)
      const service = new UsersService(repo)

      await expect(service.findOrCreateFromGoogle(identity)).resolves.toBe(user)

      expect(repo.findOrCreate).toHaveBeenCalledWith({
        googleSub: 'sub-1',
        email: 'me@example.com',
        name: 'Me',
        picture: 'https://example.com/me.png',
      })
      expect(repo.updateProfile).not.toHaveBeenCalled()
    })

    it('normalises the e-mail (trim + lowercase) before storing it', async () => {
      const repo = makeRepoMock()
      repo.findOrCreate.mockResolvedValue(fakeUser())
      const service = new UsersService(repo)

      await service.findOrCreateFromGoogle({ ...identity, email: '  Me@Example.COM ' })

      expect(repo.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'me@example.com' }),
      )
    })

    it('updates the stored e-mail at sign-in when Google reports a changed address for the same sub', async () => {
      const repo = makeRepoMock()
      repo.findOrCreate.mockResolvedValue(fakeUser({ email: 'old-address@example.com' }))
      const service = new UsersService(repo)

      const result = await service.findOrCreateFromGoogle(identity)

      expect(repo.updateProfile).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ email: 'me@example.com' }),
      )
      expect(result.email).toBe('me@example.com')
    })

    it('refreshes the profile snapshot when e-mail, name or picture changed, matching by sub and never by e-mail', async () => {
      const repo = makeRepoMock()
      repo.findOrCreate.mockResolvedValue(fakeUser({ email: 'old@example.com', name: null }))
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

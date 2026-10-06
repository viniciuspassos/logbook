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
    findOrCreate: jest.fn(),
  } as unknown as jest.Mocked<UsersRepository>
}

describe('UsersService', () => {
  describe('findOrCreateFromGoogle', () => {
    it('creates a user, asking to claim the legacy rows, when their e-mail is the legacy owner', async () => {
      const repo = makeRepoMock()
      const created = fakeUser({ id: 9 })
      repo.findByGoogleSub.mockResolvedValue(null)
      repo.findOrCreate.mockResolvedValue(created)
      const service = new UsersService(repo, { legacyOwnerEmail: 'me@example.com' })

      await expect(service.findOrCreateFromGoogle(identity)).resolves.toBe(created)

      expect(repo.findByGoogleSub).toHaveBeenCalledWith('sub-1')
      expect(repo.findOrCreate).toHaveBeenCalledWith(
        {
          googleSub: 'sub-1',
          email: 'me@example.com',
          name: 'Me',
          picture: 'https://example.com/me.png',
        },
        { claimLegacyRows: true },
      )
    })

    it('creates a user without claiming the legacy rows when they are not the legacy owner', async () => {
      const repo = makeRepoMock()
      repo.findByGoogleSub.mockResolvedValue(null)
      repo.findOrCreate.mockResolvedValue(fakeUser({ id: 10 }))
      const service = new UsersService(repo, { legacyOwnerEmail: 'someone-else@example.com' })

      await service.findOrCreateFromGoogle(identity)

      expect(repo.findOrCreate).toHaveBeenCalledWith(expect.anything(), { claimLegacyRows: false })
    })

    it('matches the legacy owner case-insensitively', async () => {
      const repo = makeRepoMock()
      repo.findByGoogleSub.mockResolvedValue(null)
      repo.findOrCreate.mockResolvedValue(fakeUser())
      const service = new UsersService(repo, { legacyOwnerEmail: 'me@example.com' })

      await service.findOrCreateFromGoogle({ ...identity, email: 'ME@Example.com' })

      expect(repo.findOrCreate).toHaveBeenCalledWith(expect.anything(), { claimLegacyRows: true })
    })

    it('runs the idempotent claim on every sign-in of the legacy owner, even when their user row already exists', async () => {
      const repo = makeRepoMock()
      const existing = fakeUser({ id: 3 })
      repo.findByGoogleSub.mockResolvedValue(existing)
      repo.findOrCreate.mockResolvedValue(existing)
      const service = new UsersService(repo, { legacyOwnerEmail: 'me@example.com' })

      await expect(service.findOrCreateFromGoogle(identity)).resolves.toBe(existing)

      expect(repo.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({ googleSub: 'sub-1' }),
        { claimLegacyRows: true },
      )
    })

    it('still refreshes the profile of an existing legacy owner whose details changed', async () => {
      const repo = makeRepoMock()
      const existing = fakeUser({ id: 3, name: null })
      repo.findByGoogleSub.mockResolvedValue(existing)
      repo.findOrCreate.mockResolvedValue(existing)
      const service = new UsersService(repo, { legacyOwnerEmail: 'me@example.com' })

      const result = await service.findOrCreateFromGoogle(identity)

      expect(repo.updateProfile).toHaveBeenCalledWith(3, expect.objectContaining({ name: 'Me' }))
      expect(result.name).toBe('Me')
    })

    it('does not run the claim for a non-owner whose user row already exists (no lock, no extra writes)', async () => {
      const repo = makeRepoMock()
      repo.findByGoogleSub.mockResolvedValue(fakeUser())
      const service = new UsersService(repo, { legacyOwnerEmail: 'someone-else@example.com' })

      await service.findOrCreateFromGoogle(identity)

      expect(repo.findOrCreate).not.toHaveBeenCalled()
    })

    it('claims for whoever LEGACY_OWNER_EMAIL names now: a later change of owner makes the new owner claim at their next sign-in', async () => {
      const repo = makeRepoMock()
      const other = fakeUser({ id: 8, googleSub: 'sub-8', email: 'new-owner@example.com' })
      repo.findByGoogleSub.mockResolvedValue(other)
      repo.findOrCreate.mockResolvedValue(other)
      const service = new UsersService(repo, { legacyOwnerEmail: 'new-owner@example.com' })

      await service.findOrCreateFromGoogle({
        sub: 'sub-8',
        email: 'new-owner@example.com',
        name: 'Me',
        picture: 'https://example.com/me.png',
      })

      expect(repo.findOrCreate).toHaveBeenCalledWith(expect.anything(), { claimLegacyRows: true })
    })

    it('normalises the e-mail (trim + lowercase) before storing it', async () => {
      const repo = makeRepoMock()
      repo.findByGoogleSub.mockResolvedValue(null)
      repo.findOrCreate.mockResolvedValue(fakeUser())
      const service = new UsersService(repo, { legacyOwnerEmail: 'someone-else@example.com' })

      await service.findOrCreateFromGoogle({ ...identity, email: '  Me@Example.COM ' })

      expect(repo.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'me@example.com' }),
        expect.anything(),
      )
    })

    it('returns the existing user without writing when the profile is unchanged', async () => {
      const repo = makeRepoMock()
      const existing = fakeUser()
      repo.findByGoogleSub.mockResolvedValue(existing)
      const service = new UsersService(repo, { legacyOwnerEmail: 'someone-else@example.com' })

      await expect(service.findOrCreateFromGoogle(identity)).resolves.toBe(existing)

      expect(repo.updateProfile).not.toHaveBeenCalled()
      expect(repo.findOrCreate).not.toHaveBeenCalled()
    })

    it('updates the stored e-mail at sign-in when Google reports a changed address for the same sub', async () => {
      const repo = makeRepoMock()
      repo.findByGoogleSub.mockResolvedValue(fakeUser({ email: 'old-address@example.com' }))
      const service = new UsersService(repo, { legacyOwnerEmail: 'someone-else@example.com' })

      const result = await service.findOrCreateFromGoogle(identity)

      expect(repo.updateProfile).toHaveBeenCalledWith(1, expect.objectContaining({ email: 'me@example.com' }))
      expect(result.email).toBe('me@example.com')
      expect(repo.findOrCreate).not.toHaveBeenCalled()
    })

    it('refreshes the profile snapshot when e-mail, name or picture changed, matching by sub and never by e-mail', async () => {
      const repo = makeRepoMock()
      repo.findByGoogleSub.mockResolvedValue(fakeUser({ email: 'old@example.com', name: null }))
      const service = new UsersService(repo, { legacyOwnerEmail: 'someone-else@example.com' })

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
      const service = new UsersService(repo, { legacyOwnerEmail: 'me@example.com' })

      await expect(service.findById(1)).resolves.toBe(user)
      expect(repo.findById).toHaveBeenCalledWith(1)
    })
  })
})

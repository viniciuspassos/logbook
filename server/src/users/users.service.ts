import { Injectable } from '@nestjs/common'
import type { GoogleIdentity } from '../auth/google-token-verifier.service'
import type { User } from './user.entity'
import { UsersRepository, type UserProfile } from './users.repository'

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  /**
   * Upserts by Google's stable `sub`, never by e-mail: an e-mail can change
   * or be reassigned, `sub` cannot, so matching on it could hand one
   * person's data to another. An existing user's e-mail/name/picture are
   * refreshed from the latest verified token when they differ.
   */
  async findOrCreateFromGoogle(identity: GoogleIdentity): Promise<User> {
    const profile: UserProfile = {
      email: identity.email,
      name: identity.name,
      picture: identity.picture,
    }

    const existing = await this.usersRepository.findByGoogleSub(identity.sub)
    if (!existing) {
      return this.usersRepository.createClaimingLegacyRowsIfFirst({
        googleSub: identity.sub,
        ...profile,
      })
    }

    if (!isSameProfile(existing, profile)) {
      await this.usersRepository.updateProfile(existing.id, profile)
      return { ...existing, ...profile }
    }
    return existing
  }

  findById(id: number): Promise<User | null> {
    return this.usersRepository.findById(id)
  }
}

function isSameProfile(user: UserProfile, profile: UserProfile): boolean {
  return (
    user.email === profile.email &&
    user.name === profile.name &&
    user.picture === profile.picture
  )
}

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
   * refreshed from the latest verified token on every sign-in when they
   * differ, and e-mails are stored trimmed and lowercased.
   */
  async findOrCreateFromGoogle(identity: GoogleIdentity): Promise<User> {
    const profile: UserProfile = {
      email: identity.email.trim().toLowerCase(),
      name: identity.name,
      picture: identity.picture,
    }

    const user = await this.usersRepository.findOrCreate({ googleSub: identity.sub, ...profile })
    if (!isSameProfile(user, profile)) {
      await this.usersRepository.updateProfile(user.id, profile)
      return { ...user, ...profile }
    }
    return user
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

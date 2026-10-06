import { Injectable } from '@nestjs/common'
import type { GoogleIdentity } from '../auth/google-token-verifier.service'
import type { User } from './user.entity'
import { UsersRepository, type UserProfile } from './users.repository'

export interface UsersServiceOptions {
  /** Lowercased e-mail of the only user who inherits the ownerless pre-accounts rows (AppConfig.legacyOwnerEmail). */
  legacyOwnerEmail: string
}

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly options: UsersServiceOptions,
  ) {}

  /**
   * Upserts by Google's stable `sub`, never by e-mail: an e-mail can change
   * or be reassigned, `sub` cannot, so matching on it could hand one
   * person's data to another. An existing user's e-mail/name/picture are
   * refreshed from the latest verified token on every sign-in when they
   * differ, and e-mails are stored trimmed and lowercased. Only the configured
   * legacy owner inherits the ownerless rows, via an idempotent claim on every
   * one of their sign-ins.
   */
  async findOrCreateFromGoogle(identity: GoogleIdentity): Promise<User> {
    const email = identity.email.trim().toLowerCase()
    const profile: UserProfile = { email, name: identity.name, picture: identity.picture }
    const isLegacyOwner = email === this.options.legacyOwnerEmail

    const existing = await this.usersRepository.findByGoogleSub(identity.sub)
    // The legacy owner always goes through findOrCreate so the idempotent
    // claim of still-ownerless rows runs on every sign-in; anyone else with a
    // row already needs no lock and no extra writes.
    const user =
      existing && !isLegacyOwner
        ? existing
        : await this.usersRepository.findOrCreate(
            { googleSub: identity.sub, ...profile },
            { claimLegacyRows: isLegacyOwner },
          )

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

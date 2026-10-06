import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { UsersService } from '../users/users.service'
import { GoogleTokenVerifier } from './google-token-verifier.service'
import { SessionsService, type CreatedSession } from './sessions.service'

export interface AuthServiceOptions {
  /** Lowercased e-mail addresses allowed to sign in (see AppConfig.allowedEmails). */
  allowedEmails: string[]
}

/** What `GET /auth/me` returns: the signed-in user's public profile. */
export interface AuthProfile {
  id: number
  email: string
  name: string | null
  picture: string | null
}

/**
 * Business logic for sign-in/sign-out. Google is the only login method: the
 * token is verified (401), the verified e-mail is checked against the
 * allowlist (403), the user is upserted by Google `sub` — the very first
 * user also inherits all pre-accounts rows, see UsersRepository — and a
 * session is created for them.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly tokenVerifier: GoogleTokenVerifier,
    private readonly usersService: UsersService,
    private readonly sessionsService: SessionsService,
    private readonly options: AuthServiceOptions,
  ) {}

  async loginWithGoogle(idToken: string): Promise<CreatedSession> {
    const identity = await this.tokenVerifier.verify(idToken)
    if (!this.options.allowedEmails.includes(identity.email.toLowerCase())) {
      throw new ForbiddenException('This Google account is not allowed to sign in')
    }
    const user = await this.usersService.findOrCreateFromGoogle(identity)
    return this.sessionsService.create(user.id)
  }

  async getProfile(userId: number): Promise<AuthProfile> {
    const user = await this.usersService.findById(userId)
    if (!user) {
      throw new UnauthorizedException('Authentication required')
    }
    return { id: user.id, email: user.email, name: user.name, picture: user.picture }
  }

  async logout(sessionToken: string): Promise<void> {
    await this.sessionsService.revoke(sessionToken)
  }
}

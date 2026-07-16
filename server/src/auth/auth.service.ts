import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PasswordHasherService } from './password-hasher.service'
import { SessionsService, type CreatedSession } from './sessions.service'

export interface AuthServiceOptions {
  authPasswordHash: string
}

/**
 * Business logic for login/logout. Single-user, so there is no "wrong
 * username vs wrong password" distinction to leak — every failed login
 * always runs the same scrypt verify against the one configured hash and
 * throws the same generic message, so a caller can't learn anything from the
 * response content or its timing about *why* a login failed.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly passwordHasher: PasswordHasherService,
    private readonly sessionsService: SessionsService,
    private readonly options: AuthServiceOptions,
  ) {}

  async login(password: string): Promise<CreatedSession> {
    const isValid = await this.passwordHasher.verify(password, this.options.authPasswordHash)
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials')
    }
    return this.sessionsService.create()
  }

  async logout(sessionToken: string): Promise<void> {
    await this.sessionsService.revoke(sessionToken)
  }
}

import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AppConfig } from '../config/configuration'

/**
 * One login method a client may offer, as published by `GET /auth/config`.
 * A discriminated union on `type`: adding a method later is a new member here
 * plus one branch in AuthConfigService.getMethods. Only data that is public
 * by design belongs in a member (a Google OAuth client ID is shipped to
 * browsers anyway); never secrets or the allowlist.
 */
export type AuthMethod = { type: 'google'; clientId: string }

/** Builds the public list of login methods this deployment currently offers, in one place. */
@Injectable()
export class AuthConfigService {
  constructor(private readonly configService: ConfigService) {}

  getMethods(): AuthMethod[] {
    const { googleAuthEnabled, googleClientId } = this.configService.getOrThrow<AppConfig>('app')
    return googleAuthEnabled ? [{ type: 'google', clientId: googleClientId }] : []
  }
}

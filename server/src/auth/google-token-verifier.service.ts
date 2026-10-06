import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OAuth2Client, type TokenPayload } from 'google-auth-library'
import type { AppConfig } from '../config/configuration'

/** The only claims the rest of the app ever sees from a verified Google ID token. */
export interface GoogleIdentity {
  /** Google's stable, never-reused account identifier. */
  sub: string
  /** Lowercased, and guaranteed `email_verified` by the verifier. */
  email: string
  name: string | null
  picture: string | null
}

/**
 * Adapter around google-auth-library's OAuth2Client — the single place the
 * third-party API is touched, so the e2e suites can override this provider
 * instead of talking to Google. `verifyIdToken` checks the signature
 * (against Google's published certs), `aud` (our client ID), `iss` and `exp`;
 * on top of that this requires `email_verified`, because an unverified
 * address must never be matched against the allowlist.
 *
 * Every failure collapses into one generic 401 so a caller can't learn from
 * the response why a token was refused.
 */
@Injectable()
export class GoogleTokenVerifier {
  private readonly client: OAuth2Client
  private readonly clientId: string

  constructor(configService: ConfigService) {
    this.clientId = configService.getOrThrow<AppConfig>('app').googleClientId
    this.client = new OAuth2Client(this.clientId)
  }

  async verify(idToken: string): Promise<GoogleIdentity> {
    const payload = await this.readPayload(idToken)
    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      throw invalidToken()
    }
    return {
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      name: payload.name ?? null,
      picture: payload.picture ?? null,
    }
  }

  private async readPayload(idToken: string): Promise<TokenPayload | undefined> {
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.clientId })
      return ticket.getPayload()
    } catch {
      throw invalidToken()
    }
  }
}

function invalidToken(): UnauthorizedException {
  return new UnauthorizedException('Invalid Google ID token')
}

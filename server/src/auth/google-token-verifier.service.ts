import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
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
 * The OAuth2Client is created on first use, so a deployment with Google login
 * disabled (the provider still exists, but the route is gated) never builds one.
 *
 * Every failure (a bad token, or Google/the network being unreachable) is
 * logged server-side and collapses into one generic 401, so a caller can't
 * learn from the response why it was refused.
 */
@Injectable()
export class GoogleTokenVerifier {
  private readonly logger = new Logger(GoogleTokenVerifier.name)
  private readonly clientId: string
  private client?: OAuth2Client

  constructor(configService: ConfigService) {
    this.clientId = configService.getOrThrow<AppConfig>('app').googleClientId
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
      this.client ??= new OAuth2Client(this.clientId)
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.clientId })
      return ticket.getPayload()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.logger.warn(`ID token verification failed: ${reason}`)
      throw invalidToken()
    }
  }
}

function invalidToken(): UnauthorizedException {
  return new UnauthorizedException('Invalid Google ID token')
}

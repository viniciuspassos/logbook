import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
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
 * A token the library recognisably rejects (wrong audience, expired, bad
 * signature, ...) collapses into one generic 401 so a caller can't learn from
 * the response why it was refused. Every other failure (network, TLS, abort,
 * cert fetch, anything unrecognised) is not the caller's fault: it is logged
 * and answered with 503 so the client can retry instead of treating it as a
 * rejected sign-in.
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
      if (isKnownInvalidToken(error)) {
        throw invalidToken()
      }
      // Anything that is not a recognised token failure (network, TLS, abort,
      // gaxios, an unknown shape) fails toward "try again", never toward
      // "your token is bad".
      const reason = error instanceof Error ? error.message : String(error)
      this.logger.warn(`Could not verify an ID token (not a token failure): ${reason}`)
      throw new ServiceUnavailableException('Google sign-in is temporarily unavailable')
    }
  }
}

/**
 * The messages google-auth-library throws when the *token itself* is bad
 * (prefixes; some carry the offending token/payload after them). Only these
 * map to 401; everything else is treated as an infrastructure problem (503),
 * so a new or unexpected error can never turn an outage into "invalid
 * credentials". A test pins each prefix to the installed library's source, so
 * an upgrade that rewords one fails loudly.
 */
export const KNOWN_INVALID_TOKEN_MESSAGES: readonly string[] = [
  'The verifyIdToken method requires an ID Token',
  'Wrong number of segments in token',
  "Can't parse token envelope",
  "Can't parse token payload",
  'No pem found for envelope',
  'Invalid token signature',
  'No issue time in token',
  'No expiration time in token',
  'iat field using invalid format',
  'exp field using invalid format',
  'Expiration time too far in future',
  'Token used too early',
  'Token used too late',
  'Invalid issuer, expected one of',
  'Wrong recipient, payload audience != requiredAudience',
]

function isKnownInvalidToken(error: unknown): boolean {
  return (
    error instanceof Error &&
    KNOWN_INVALID_TOKEN_MESSAGES.some((message) => error.message.startsWith(message))
  )
}

function invalidToken(): UnauthorizedException {
  return new UnauthorizedException('Invalid Google ID token')
}

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
 * A bad token collapses into one generic 401 so a caller can't learn from
 * the response why it was refused. Failing to reach Google at all (network,
 * cert fetch, upstream 5xx) is not the caller's fault: it is logged and
 * answered with 503 so the client can retry instead of treating it as a
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
      if (isInfrastructureError(error)) {
        const reason = error instanceof Error ? error.message : String(error)
        this.logger.warn(`Could not reach Google to verify an ID token: ${reason}`)
        throw new ServiceUnavailableException('Google sign-in is temporarily unavailable')
      }
      throw invalidToken()
    }
  }
}

/**
 * Node network error codes that mean "could not reach Google". An explicit
 * list, not a pattern: an unrelated `E*`/`ERR_*` code (EACCES, a TLS parse
 * error) must not turn a bad token into a retryable-looking 503.
 */
const NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'ECONNABORTED',
  'ENETUNREACH',
  'EHOSTUNREACH',
])

/**
 * Prefix google-auth-library puts on failures fetching Google's signing
 * certs. A test pins it against the installed library's source, so an
 * upgrade that changes the message fails loudly.
 */
export const CERT_FETCH_FAILURE_PREFIX = 'Failed to retrieve verification certificates'

/**
 * True when verification failed because Google (or the network to it) could
 * not be reached, as opposed to the token itself being bad: a listed Node
 * network code, an upstream HTTP 5xx (gaxios puts it on `response.status`),
 * or the library's cert-fetch failure message. Anything else stays an
 * invalid-token 401, the safe side for an authentication check.
 */
function isInfrastructureError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const { code, status, response, message } = error as {
    code?: unknown
    status?: unknown
    response?: { status?: unknown }
    message?: unknown
  }
  const httpStatus = typeof status === 'number' ? status : response?.status
  return (
    (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) ||
    (typeof httpStatus === 'number' && httpStatus >= 500) ||
    (typeof message === 'string' && message.startsWith(CERT_FETCH_FAILURE_PREFIX))
  )
}

function invalidToken(): UnauthorizedException {
  return new UnauthorizedException('Invalid Google ID token')
}

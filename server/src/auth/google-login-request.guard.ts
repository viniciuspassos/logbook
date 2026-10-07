import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common'
import type { Request } from 'express'

/** Header the web client must send on POST /auth/google; lowercase, as Node exposes request headers. */
export const LOGIN_CLIENT_HEADER_NAME = 'x-logbook-client'
export const LOGIN_CLIENT_HEADER_VALUE = 'web'

/**
 * Login-CSRF defence for `POST /auth/google`, which is public and so skips
 * CsrfGuard. Without it a cross-site page could submit the *attacker's own*
 * Google ID token and sign the victim's browser into the attacker's account.
 * It requires a custom `X-Logbook-Client: web` header (generic 403
 * otherwise): a cross-site HTML form cannot set one, and a cross-site `fetch`
 * that does would need a CORS preflight, which this server never grants (CORS
 * is not enabled; an e2e test asserts that, since this defence depends on it).
 */
@Injectable()
export class GoogleLoginRequestGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { headers } = context.switchToHttp().getRequest<Pick<Request, 'headers'>>()
    if (headers[LOGIN_CLIENT_HEADER_NAME] !== LOGIN_CLIENT_HEADER_VALUE) {
      throw new ForbiddenException()
    }
    return true
  }
}

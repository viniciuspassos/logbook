import {
  ForbiddenException,
  Injectable,
  UnsupportedMediaTypeException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common'
import type { Request } from 'express'

/** Header the web client must send on POST /auth/google; lowercase, as Node exposes request headers. */
export const LOGIN_CLIENT_HEADER_NAME = 'x-logbook-client'
export const LOGIN_CLIENT_HEADER_VALUE = 'web'

const JSON_CONTENT_TYPE = /^application\/json\s*(;|$)/i

/**
 * Login-CSRF defence for `POST /auth/google`, which is public and so skips
 * CsrfGuard. Without it a cross-site page could submit the *attacker's own*
 * Google ID token and sign the victim's browser into the attacker's account.
 * Defence in depth, checked before anything is verified:
 *  1. `Content-Type: application/json` (415 otherwise): an HTML form can only
 *     send urlencoded/multipart/text-plain, never JSON.
 *  2. a custom `X-Logbook-Client: web` header (403 otherwise): a cross-site
 *     form cannot set it, and a cross-site `fetch` that does would need a CORS
 *     preflight, which this server never grants (CORS is not enabled).
 *  3. a browser-declared `Sec-Fetch-Site: cross-site` is refused (403).
 * Refusals are a generic 403 so nothing about the check leaks.
 */
@Injectable()
export class GoogleLoginRequestGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { headers } = context.switchToHttp().getRequest<Pick<Request, 'headers'>>()

    const contentType = headers['content-type']
    if (typeof contentType !== 'string' || !JSON_CONTENT_TYPE.test(contentType)) {
      throw new UnsupportedMediaTypeException('Content-Type must be application/json')
    }
    if (
      headers[LOGIN_CLIENT_HEADER_NAME] !== LOGIN_CLIENT_HEADER_VALUE ||
      headers['sec-fetch-site'] === 'cross-site'
    ) {
      throw new ForbiddenException()
    }
    return true
  }
}

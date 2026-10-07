import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { getCsrfHeaderToken } from './cookies'
import { IS_PUBLIC_KEY } from './public.decorator'
import type { RequestWithSession } from './request-with-session'
import { timingSafeEqualStrings } from './token.util'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Double-submit CSRF check for state-changing requests, layered on top of
 * SameSite=Lax cookies (see cookies.ts) rather than relying on SameSite
 * alone. SameSite=Lax is not treated as sufficient by itself because this
 * API's future frontend origin/deployment topology isn't settled yet
 * (issue tracked separately, frontend integration is out of scope here) —
 * Lax also still allows some cross-site top-level GET navigations through,
 * and doesn't help at all if a future deployment needs SameSite=None for a
 * genuinely cross-origin frontend. A token the attacker's page can't read
 * (this cookie is intentionally *not* httpOnly, but it's still bound to the
 * same-origin policy — a cross-site page can trigger the request but can't
 * read the cookie to put its value in a header) closes that gap regardless
 * of the eventual origin story.
 *
 * Only applies to mutating methods; GET/HEAD/OPTIONS never need it. Runs
 * after SessionAuthGuard (registration order in AuthModule) so `request
 * .session` is normally already set — if it's ever missing here anyway this
 * fails closed (403) rather than assuming authentication happened.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) {
      return true
    }

    const request = context.switchToHttp().getRequest<RequestWithSession>()
    if (SAFE_METHODS.has(request.method)) {
      return true
    }

    const session = request.session
    if (!session) {
      throw new ForbiddenException('CSRF validation failed')
    }

    const headerToken = getCsrfHeaderToken(request)
    if (!headerToken || !timingSafeEqualStrings(headerToken, session.csrfToken)) {
      throw new ForbiddenException('CSRF validation failed')
    }

    return true
  }
}

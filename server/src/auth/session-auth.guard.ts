import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import type { Response } from 'express'
import type { AppConfig } from '../config/configuration'
import { getSessionCookie, setSessionCookies } from './cookies'
import { IS_SESSION_OPTIONAL_KEY } from './optional-session.decorator'
import { IS_PUBLIC_KEY } from './public.decorator'
import type { RequestWithSession } from './request-with-session'
import { SessionsService } from './sessions.service'

/**
 * Global auth guard (registered as APP_GUARD in AuthModule, not per
 * controller): every route is protected by default, and a route opts out
 * explicitly with `@Public()` (health, login). This "fail closed" default
 * was chosen over per-controller `@UseGuards()` specifically because the
 * failure mode of forgetting to protect a route is silent — a new
 * entries/attachments controller added later would ship unauthenticated
 * unless someone remembered to wire the guard onto it. A second, narrower
 * opt-out, `@OptionalSession()`, lets a route (logout) run without a valid
 * session while still attaching one when it exists. Opt-out-by-exception
 * makes the safe behaviour the path of least resistance instead.
 *
 * When SessionsService slides the expiry forward it also re-issues both
 * cookies with the new expiry, so the browser's cookie never lags the
 * server's idea of when the session actually expires; otherwise it sets no
 * cookies.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) {
      return true
    }

    const request = context.switchToHttp().getRequest<RequestWithSession>()
    const sessionToken = getSessionCookie(request)
    const validated = sessionToken ? await this.sessionsService.validate(sessionToken) : null
    if (!sessionToken || !validated) {
      // An @OptionalSession() route (logout) proceeds with no session
      // attached; CsrfGuard then has nothing to protect.
      if (this.isSessionOptional(context)) {
        return true
      }
      throw new UnauthorizedException('Authentication required')
    }
    const { session, renewed } = validated

    request.session = session
    request.userId = session.userId

    // Cookies are only re-issued when the expiry actually slid forward; on
    // every other request the browser's existing cookies are still correct.
    if (renewed) {
      const response = context.switchToHttp().getResponse<Response>()
      const { cookieSecure } = this.configService.getOrThrow<AppConfig>('app')
      setSessionCookies(
        response,
        { sessionToken, csrfToken: session.csrfToken, expiresAt: session.expiresAt },
        { secure: cookieSecure },
      )
    }

    return true
  }

  private isSessionOptional(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_SESSION_OPTIONAL_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    )
  }
}

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
 * unless someone remembered to wire the guard onto it. Opt-out-by-exception
 * makes the safe behaviour the path of least resistance instead.
 *
 * On every authenticated request it also re-issues both cookies with the
 * (possibly just-renewed, see SessionsService) expiry, so the browser's
 * cookie never lags the server's idea of when the session actually expires.
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
    if (!sessionToken) {
      throw new UnauthorizedException('Authentication required')
    }

    const session = await this.sessionsService.validate(sessionToken)
    if (!session) {
      throw new UnauthorizedException('Authentication required')
    }

    request.session = session

    const response = context.switchToHttp().getResponse<Response>()
    const { cookieSecure } = this.configService.getOrThrow<AppConfig>('app')
    setSessionCookies(
      response,
      { sessionToken, csrfToken: session.csrfToken, expiresAt: session.expiresAt },
      { secure: cookieSecure },
    )

    return true
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request, Response } from 'express'
import type { AppConfig } from '../config/configuration'
import { clearSessionCookies, getSessionCookie, setSessionCookies } from './cookies'
import { CurrentUserId } from './current-user.decorator'
import { GoogleLoginDto } from './dto/google-login.dto'
import { GoogleAuthEnabledGuard } from './google-auth-enabled.guard'
import { OptionalSession } from './optional-session.decorator'
import { Public } from './public.decorator'
import type { RequestWithSession } from './request-with-session'
import { AuthService, type AuthProfile } from './auth.service'

export type AuthConfigResponse =
  | { googleEnabled: true; googleClientId: string }
  | { googleEnabled: false }

export interface AuthStatusResponse {
  status: 'ok'
}

/**
 * Thin HTTP layer: routes + validation (GoogleLoginDto) + cookie plumbing,
 * delegating the actual token check and session lifecycle to
 * AuthService/SessionsService. No database access happens here.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  /** Public, secret-free: lets a client learn whether Google login is on (and the client ID only then). */
  @Public()
  @Get('config')
  config(): AuthConfigResponse {
    const { googleAuthEnabled, googleClientId } = this.configService.getOrThrow<AppConfig>('app')
    return googleAuthEnabled ? { googleEnabled: true, googleClientId } : { googleEnabled: false }
  }

  @Public()
  @UseGuards(GoogleAuthEnabledGuard)
  @Post('google')
  @HttpCode(HttpStatus.OK)
  async loginWithGoogle(
    @Body() dto: GoogleLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthStatusResponse> {
    const created = await this.authService.loginWithGoogle(dto.idToken)
    setSessionCookies(res, created, { secure: this.cookieSecure() })
    return { status: 'ok' }
  }

  /**
   * Besides returning the profile, re-issues both session cookies. The app
   * calls this at every launch, so a client that missed an earlier Set-Cookie
   * (the guard only re-issues them when the expiry slides) resyncs at least
   * once per launch instead of letting its cookies expire before the server
   * session does.
   */
  @Get('me')
  async me(
    @CurrentUserId() userId: number,
    @Req() req: RequestWithSession,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthProfile> {
    const sessionToken = getSessionCookie(req)
    if (req.session && sessionToken) {
      setSessionCookies(
        res,
        {
          sessionToken,
          csrfToken: req.session.csrfToken,
          expiresAt: req.session.expiresAt,
        },
        { secure: this.cookieSecure() },
      )
    }
    return this.authService.getProfile(userId)
  }

  /**
   * `@OptionalSession()`, not `@Public()`: logout must work with no valid
   * session (a client whose session expired/was revoked, including by an
   * allowlist removal, would otherwise get a 401 and never clear its stale
   * cookies), but a caller that DOES have a live session still goes through
   * CsrfGuard, so a cross-site POST can't revoke a victim's session. With no
   * session (none, expired or revoked) it just clears the cookies — nothing
   * to protect — and always answers 200.
   */
  @OptionalSession()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthStatusResponse> {
    const sessionToken = getSessionCookie(req)
    if (sessionToken) {
      await this.authService.logout(sessionToken)
    }
    clearSessionCookies(res, { secure: this.cookieSecure() })
    return { status: 'ok' }
  }

  private cookieSecure(): boolean {
    return this.configService.getOrThrow<AppConfig>('app').cookieSecure
  }
}

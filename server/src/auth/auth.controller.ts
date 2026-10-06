import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request, Response } from 'express'
import type { AppConfig } from '../config/configuration'
import { clearSessionCookies, getSessionCookie, setSessionCookies } from './cookies'
import { CurrentUserId } from './current-user.decorator'
import { GoogleLoginDto } from './dto/google-login.dto'
import { Public } from './public.decorator'
import { AuthService, type AuthProfile } from './auth.service'

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

  @Public()
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

  @Get('me')
  me(@CurrentUserId() userId: number): Promise<AuthProfile> {
    return this.authService.getProfile(userId)
  }

  /**
   * `@Public()` on purpose: logout must work with no valid session, or a
   * client whose session expired/was revoked (including by an allowlist
   * removal) gets a 401 and its stale cookies are never cleared. It always
   * answers 200 and clears both cookies, and revokes the session only when a
   * token is present. Skipping the CSRF check is safe here: with no (or an
   * already-dead) session there is nothing to protect, and the worst a forged
   * cross-site logout can do is sign the user out, which they can undo by
   * signing in again.
   */
  @Public()
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

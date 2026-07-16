import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request, Response } from 'express'
import type { AppConfig } from '../config/configuration'
import { clearSessionCookies, getSessionCookie, setSessionCookies } from './cookies'
import { LoginDto } from './dto/login.dto'
import { Public } from './public.decorator'
import { AuthService } from './auth.service'

export interface AuthStatusResponse {
  status: 'ok'
}

/**
 * Thin HTTP layer: routes + validation (LoginDto) + cookie plumbing,
 * delegating the actual credential check and session lifecycle to
 * AuthService/SessionsService. No database access happens here.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response): Promise<AuthStatusResponse> {
    const created = await this.authService.login(dto.password)
    setSessionCookies(res, created, { secure: this.cookieSecure() })
    return { status: 'ok' }
  }

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

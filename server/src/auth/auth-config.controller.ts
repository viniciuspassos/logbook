import { Controller, Get, Res } from '@nestjs/common'
import type { Response } from 'express'
import { AuthConfigService, type AuthMethod } from './auth-config.service'
import { Public } from './public.decorator'

export interface AuthConfigResponse {
  methods: AuthMethod[]
}

/**
 * `GET /auth/config`: how a client learns which login methods this backend
 * offers (the frontend has no flag or client ID of its own). Public — no
 * session, no CSRF, never 401 — and `no-store`, so flipping
 * GOOGLE_AUTH_ENABLED is seen on the next call instead of from a cache.
 */
@Controller('auth')
export class AuthConfigController {
  constructor(private readonly authConfigService: AuthConfigService) {}

  @Public()
  @Get('config')
  config(@Res({ passthrough: true }) res: Response): AuthConfigResponse {
    res.setHeader('Cache-Control', 'no-store')
    return { methods: this.authConfigService.getMethods() }
  }
}

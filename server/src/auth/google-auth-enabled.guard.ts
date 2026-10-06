import { Injectable, NotFoundException, type CanActivate } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AppConfig } from '../config/configuration'

/**
 * Route guard for `POST /auth/google`: when the `GOOGLE_AUTH_ENABLED` flag is
 * off the route answers 404, exactly as if it were not registered. It runs
 * before body validation, so a disabled deployment never reveals anything
 * about the route (not even a 400 for a malformed body).
 */
@Injectable()
export class GoogleAuthEnabledGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(): boolean {
    if (!this.configService.getOrThrow<AppConfig>('app').googleAuthEnabled) {
      throw new NotFoundException()
    }
    return true
  }
}

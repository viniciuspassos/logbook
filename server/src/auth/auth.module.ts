import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { TypeOrmModule } from '@nestjs/typeorm'
import type { AppConfig } from '../config/configuration'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { CsrfGuard } from './csrf.guard'
import { UsersModule } from '../users/users.module'
import { UsersService } from '../users/users.service'
import { GoogleTokenVerifier } from './google-token-verifier.service'
import { Session } from './session.entity'
import { SessionAuthGuard } from './session-auth.guard'
import { SessionsRepository } from './sessions.repository'
import { SessionsService } from './sessions.service'

/**
 * Registers SessionAuthGuard then CsrfGuard as global (APP_GUARD) providers
 * — every route in the app is protected by default; see SessionAuthGuard's
 * doc comment for why that's the chosen default over per-controller
 * `@UseGuards()`. Registration order matters: Nest runs multiple APP_GUARDs
 * in registration order, and CsrfGuard depends on SessionAuthGuard having
 * already attached `request.session`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Session]), UsersModule],
  controllers: [AuthController],
  providers: [
    GoogleTokenVerifier,
    SessionsRepository,
    {
      provide: SessionsService,
      inject: [SessionsRepository, ConfigService],
      useFactory: (sessionsRepository: SessionsRepository, configService: ConfigService) =>
        new SessionsService(sessionsRepository, {
          sessionTtlDays: configService.getOrThrow<AppConfig>('app').sessionTtlDays,
          allowedEmails: configService.getOrThrow<AppConfig>('app').allowedEmails,
        }),
    },
    {
      provide: AuthService,
      inject: [GoogleTokenVerifier, UsersService, SessionsService, ConfigService],
      useFactory: (
        tokenVerifier: GoogleTokenVerifier,
        usersService: UsersService,
        sessionsService: SessionsService,
        configService: ConfigService,
      ) =>
        new AuthService(tokenVerifier, usersService, sessionsService, {
          allowedEmails: configService.getOrThrow<AppConfig>('app').allowedEmails,
        }),
    },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
  exports: [SessionsService],
})
export class AuthModule {}

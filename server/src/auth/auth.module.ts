import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { TypeOrmModule } from '@nestjs/typeorm'
import type { AppConfig } from '../config/configuration'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { CsrfGuard } from './csrf.guard'
import { PasswordHasherService } from './password-hasher.service'
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
  imports: [TypeOrmModule.forFeature([Session])],
  controllers: [AuthController],
  providers: [
    PasswordHasherService,
    SessionsRepository,
    {
      provide: SessionsService,
      inject: [SessionsRepository, ConfigService],
      useFactory: (sessionsRepository: SessionsRepository, configService: ConfigService) =>
        new SessionsService(sessionsRepository, {
          sessionTtlDays: configService.getOrThrow<AppConfig>('app').sessionTtlDays,
        }),
    },
    {
      provide: AuthService,
      inject: [PasswordHasherService, SessionsService, ConfigService],
      useFactory: (
        passwordHasher: PasswordHasherService,
        sessionsService: SessionsService,
        configService: ConfigService,
      ) =>
        new AuthService(passwordHasher, sessionsService, {
          authPasswordHash: configService.getOrThrow<AppConfig>('app').authPasswordHash,
        }),
    },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
  exports: [SessionsService],
})
export class AuthModule {}

import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import type { AppConfig } from '../config/configuration'
import { User } from './user.entity'
import { UsersRepository } from './users.repository'
import { UsersService } from './users.service'

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [
    UsersRepository,
    {
      provide: UsersService,
      inject: [UsersRepository, ConfigService],
      useFactory: (usersRepository: UsersRepository, configService: ConfigService) =>
        new UsersService(usersRepository, {
          legacyOwnerEmail: configService.getOrThrow<AppConfig>('app').legacyOwnerEmail,
        }),
    },
  ],
  exports: [UsersService],
})
export class UsersModule {}

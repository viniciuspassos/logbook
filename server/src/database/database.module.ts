import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { buildTypeOrmOptions } from './typeorm.config'
import type { AppConfig } from '../config/configuration'

// Schema is managed entirely by TypeORM migrations (#21) — see
// typeorm.config.ts for `synchronize: false` / `migrationsRun: true`, and
// data-source.ts + package.json's `migration:*` scripts for the CLI used to
// generate/run/revert them. `migrationsRun: true` means pending migrations
// apply automatically the moment this module establishes its connection
// (i.e. on app boot, in every environment) — see typeorm.config.ts's
// docstring for why, and docs/INFRASTRUCTURE.md for the day-to-day
// "changed an entity, now what?" workflow.
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        buildTypeOrmOptions(configService.getOrThrow<AppConfig>('app')),
    }),
  ],
})
export class DatabaseModule {}

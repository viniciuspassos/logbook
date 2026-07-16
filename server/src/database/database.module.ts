import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { buildTypeOrmOptions } from './typeorm.config'
import type { AppConfig } from '../config/configuration'

// NOTE (deferred, flagged for a human decision): synchronize:true (see
// typeorm.config.ts) auto-creates/updates schema from entities, which is fine
// for this foundational pass but is not a migration strategy. Before a real
// production deploy, replace this with TypeORM migrations
// (`typeorm migration:generate` / `migration:run`) so schema changes are
// reviewable and reversible.
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

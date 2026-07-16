import type { TypeOrmModuleOptions } from '@nestjs/typeorm'
import type { AppConfig } from '../config/configuration'

/**
 * Pure factory from AppConfig -> TypeORM options, kept separate from the
 * NestJS module wiring (database.module.ts) so it's unit-testable without
 * spinning up Nest's DI container or a real database connection.
 *
 * `synchronize` is intentionally tied to nodeEnv: true in dev/test for fast
 * iteration on this foundational schema, false in production where a real
 * migration path should exist instead (not yet added — see TODO in
 * database.module.ts).
 */
export function buildTypeOrmOptions(config: AppConfig): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    url: config.databaseUrl,
    autoLoadEntities: true,
    synchronize: config.nodeEnv !== 'production',
    logging: false,
  }
}

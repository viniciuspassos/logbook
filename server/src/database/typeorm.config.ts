import type { TypeOrmModuleOptions } from '@nestjs/typeorm'
import type { AppConfig } from '../config/configuration'
import { migrationsGlob } from './migrations-path.util'

/**
 * Pure factory from AppConfig -> TypeORM options, kept separate from the
 * NestJS module wiring (database.module.ts) so it's unit-testable without
 * spinning up Nest's DI container or a real database connection.
 *
 * `synchronize` is always `false` (#21): auto-sync from entities is gone in
 * every environment, including development — dev and production both run
 * TypeORM migrations instead (`migrationsRun: true` below), so schema
 * changes are reviewable, reversible, and checked for drift in CI rather
 * than silently diverging per-environment. The e2e suites are the one
 * exception, and deliberately don't go through this factory at all — they
 * build their own literal `TypeOrmModule.forRoot({ synchronize: true, ... })`
 * against an in-memory sqlite database (see entries.e2e.test.ts and
 * friends) because migrations are dialect-specific SQL and those suites
 * test behavior, not the schema deploy path.
 */
export function buildTypeOrmOptions(config: AppConfig): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    url: config.databaseUrl,
    autoLoadEntities: true,
    synchronize: false,
    migrations: [migrationsGlob()],
    migrationsRun: true,
    logging: false,
  }
}

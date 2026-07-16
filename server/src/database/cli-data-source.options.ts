import type { DataSourceOptions } from 'typeorm'
import { allEntities } from './entities'
import { migrationsGlob } from './migrations-path.util'

/**
 * Pure factory for the TypeORM CLI DataSource's connection options, kept
 * separate from `data-source.ts` (env loading + the actual `DataSource`
 * instance the CLI imports) the same way `buildTypeOrmOptions` is kept
 * separate from `database.module.ts` — so it's unit-testable without
 * touching `process.env` or constructing a real `DataSource`.
 *
 * Deliberately takes a plain `databaseUrl` string rather than the app's
 * `AppConfig`: the CLI only ever needs a connection string to
 * generate/run/revert migrations, and requiring the rest of `AppConfig`
 * (e.g. `AUTH_PASSWORD_HASH`) would force a contributor to set unrelated
 * auth config just to run `migration:generate`.
 */
export function buildCliDataSourceOptions(databaseUrl: string): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    entities: allEntities,
    migrations: [migrationsGlob()],
    synchronize: false,
  }
}

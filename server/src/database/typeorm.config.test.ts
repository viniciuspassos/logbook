import { buildTypeOrmOptions } from './typeorm.config'
import { migrationsGlob } from './migrations-path.util'
import type { AppConfig } from '../config/configuration'

function fakeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 3000,
    nodeEnv: 'development',
    databaseUrl: 'postgres://user:pass@localhost:5432/logbook',
    uploadDir: '/tmp/uploads',
    maxUploadSizeBytes: 1024,
    authPasswordHash: 'scrypt$16384$abcd$ef01',
    sessionTtlDays: 30,
    cookieSecure: false,
    ...overrides,
  }
}

describe('buildTypeOrmOptions', () => {
  it('targets postgres using the configured connection string', () => {
    const options = buildTypeOrmOptions(fakeConfig())

    expect(options.type).toBe('postgres')
    expect(options).toMatchObject({ url: 'postgres://user:pass@localhost:5432/logbook' })
    expect(options.autoLoadEntities).toBe(true)
  })

  // Behavior change (#21): synchronize used to be true outside production so
  // schema auto-synced from entities in dev. That's gone in every
  // environment now — dev and production both run TypeORM migrations
  // (migrationsRun below), so schema drift is caught by review and the CI
  // drift check instead of silently diverging per-environment. Only the e2e
  // suites still use synchronize:true, and they do so via their own literal
  // TypeOrmModule.forRoot({ synchronize: true, ... }) sqlite setup, entirely
  // separate from this factory — see entries.e2e.test.ts and friends.
  it('disables schema sync in development (migrations are used instead)', () => {
    const options = buildTypeOrmOptions(fakeConfig({ nodeEnv: 'development' }))

    expect(options.synchronize).toBe(false)
  })

  it('disables schema sync in production (migrations are used instead)', () => {
    const options = buildTypeOrmOptions(fakeConfig({ nodeEnv: 'production' }))

    expect(options.synchronize).toBe(false)
  })

  it('runs pending migrations automatically on connection, in every environment', () => {
    const options = buildTypeOrmOptions(fakeConfig())

    expect(options.migrationsRun).toBe(true)
  })

  it('points at the shared migrations glob so the app finds the same migrations the CLI does', () => {
    const options = buildTypeOrmOptions(fakeConfig())

    expect(options.migrations).toEqual([migrationsGlob()])
  })
})

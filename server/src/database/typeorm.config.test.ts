import { buildTypeOrmOptions } from './typeorm.config'
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

  it('enables schema sync outside production', () => {
    const options = buildTypeOrmOptions(fakeConfig({ nodeEnv: 'development' }))

    expect(options.synchronize).toBe(true)
  })

  it('disables schema sync in production (migrations are expected instead)', () => {
    const options = buildTypeOrmOptions(fakeConfig({ nodeEnv: 'production' }))

    expect(options.synchronize).toBe(false)
  })
})

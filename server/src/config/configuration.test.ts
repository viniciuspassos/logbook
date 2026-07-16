import { loadConfig } from './configuration'

describe('loadConfig', () => {
  const baseEnv = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/logbook',
    AUTH_PASSWORD_HASH: 'scrypt$16384$abcd$ef01',
  }

  it('throws if DATABASE_URL is missing', () => {
    expect(() => loadConfig({ AUTH_PASSWORD_HASH: baseEnv.AUTH_PASSWORD_HASH })).toThrow(
      /DATABASE_URL/,
    )
  })

  it('throws if AUTH_PASSWORD_HASH is missing', () => {
    expect(() => loadConfig({ DATABASE_URL: baseEnv.DATABASE_URL })).toThrow(
      /AUTH_PASSWORD_HASH/,
    )
  })

  it('applies defaults when optional vars are absent', () => {
    const config = loadConfig(baseEnv)

    expect(config).toEqual({
      port: 3000,
      nodeEnv: 'development',
      databaseUrl: baseEnv.DATABASE_URL,
      uploadDir: expect.stringContaining('uploads'),
      maxUploadSizeBytes: 10 * 1024 * 1024,
      authPasswordHash: baseEnv.AUTH_PASSWORD_HASH,
      sessionTtlDays: 30,
      cookieSecure: false,
    })
  })

  it('parses provided env vars over defaults', () => {
    const config = loadConfig({
      ...baseEnv,
      PORT: '4321',
      NODE_ENV: 'production',
      UPLOAD_DIR: '/data/uploads',
      MAX_UPLOAD_SIZE_BYTES: '2048',
      SESSION_TTL_DAYS: '7',
    })

    expect(config).toEqual({
      port: 4321,
      nodeEnv: 'production',
      databaseUrl: baseEnv.DATABASE_URL,
      uploadDir: '/data/uploads',
      maxUploadSizeBytes: 2048,
      authPasswordHash: baseEnv.AUTH_PASSWORD_HASH,
      sessionTtlDays: 7,
      cookieSecure: true,
    })
  })

  it('treats NODE_ENV=production as requiring secure cookies', () => {
    const config = loadConfig({ ...baseEnv, NODE_ENV: 'production' })

    expect(config.cookieSecure).toBe(true)
  })
})

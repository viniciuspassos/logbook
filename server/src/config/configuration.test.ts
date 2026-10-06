import { loadConfig } from './configuration'

describe('loadConfig', () => {
  const baseEnv = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/logbook',
    GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
    ALLOWED_EMAILS: 'me@example.com',
  }

  it('throws if DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omitted, ...rest } = baseEnv
    expect(() => loadConfig(rest)).toThrow(/DATABASE_URL/)
  })

  it('throws if GOOGLE_CLIENT_ID is missing', () => {
    const { GOOGLE_CLIENT_ID: _omitted, ...rest } = baseEnv
    expect(() => loadConfig(rest)).toThrow(/GOOGLE_CLIENT_ID/)
  })

  it('throws if ALLOWED_EMAILS is missing', () => {
    const { ALLOWED_EMAILS: _omitted, ...rest } = baseEnv
    expect(() => loadConfig(rest)).toThrow(/ALLOWED_EMAILS/)
  })

  it('throws if ALLOWED_EMAILS contains no addresses', () => {
    expect(() => loadConfig({ ...baseEnv, ALLOWED_EMAILS: ' , ,' })).toThrow(/ALLOWED_EMAILS/)
  })

  it('applies defaults when optional vars are absent', () => {
    const config = loadConfig(baseEnv)

    expect(config).toEqual({
      port: 3000,
      nodeEnv: 'development',
      databaseUrl: baseEnv.DATABASE_URL,
      uploadDir: expect.stringContaining('uploads'),
      maxUploadSizeBytes: 25 * 1024 * 1024,
      googleClientId: baseEnv.GOOGLE_CLIENT_ID,
      allowedEmails: ['me@example.com'],
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
      googleClientId: baseEnv.GOOGLE_CLIENT_ID,
      allowedEmails: ['me@example.com'],
      sessionTtlDays: 7,
      cookieSecure: true,
    })
  })

  it('trims and lowercases a comma-separated ALLOWED_EMAILS list, dropping blanks', () => {
    const config = loadConfig({
      ...baseEnv,
      ALLOWED_EMAILS: ' Me@Example.com, friend@example.com ,,',
    })

    expect(config.allowedEmails).toEqual(['me@example.com', 'friend@example.com'])
  })

  it('treats NODE_ENV=production as requiring secure cookies', () => {
    const config = loadConfig({ ...baseEnv, NODE_ENV: 'production' })

    expect(config.cookieSecure).toBe(true)
  })
})

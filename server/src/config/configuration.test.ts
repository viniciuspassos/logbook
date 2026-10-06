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
      legacyOwnerEmail: 'me@example.com',
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
      legacyOwnerEmail: 'me@example.com',
      sessionTtlDays: 7,
      cookieSecure: true,
    })
  })

  it('trims and lowercases a comma-separated ALLOWED_EMAILS list, dropping blanks', () => {
    const config = loadConfig({
      ...baseEnv,
      ALLOWED_EMAILS: ' Me@Example.com, friend@example.com ,,',
      LEGACY_OWNER_EMAIL: 'me@example.com',
    })

    expect(config.allowedEmails).toEqual(['me@example.com', 'friend@example.com'])
  })

  it.each([
    ['PORT', 'abc'],
    ['PORT', '-1'],
    ['PORT', '65536'],
    ['PORT', '80.5'],
    ['SESSION_TTL_DAYS', 'abc'],
    ['SESSION_TTL_DAYS', '0'],
    ['SESSION_TTL_DAYS', '-3'],
    ['SESSION_TTL_DAYS', '1.5'],
    ['MAX_UPLOAD_SIZE_BYTES', 'lots'],
    ['MAX_UPLOAD_SIZE_BYTES', '0'],
  ])('throws a clear error when %s is %p (not a valid number)', (name, value) => {
    expect(() => loadConfig({ ...baseEnv, [name]: value })).toThrow(new RegExp(name))
  })

  it('accepts the PORT boundaries 0 (ephemeral port, used by e2e/dev) and 65535', () => {
    expect(loadConfig({ ...baseEnv, PORT: '0' }).port).toBe(0)
    expect(loadConfig({ ...baseEnv, PORT: '1' }).port).toBe(1)
    expect(loadConfig({ ...baseEnv, PORT: '65535' }).port).toBe(65535)
  })

  describe('LEGACY_OWNER_EMAIL', () => {
    it('defaults to the sole allowlisted e-mail', () => {
      expect(loadConfig(baseEnv).legacyOwnerEmail).toBe('me@example.com')
    })

    it('uses the configured owner, lowercased and trimmed, when several e-mails are allowlisted', () => {
      const config = loadConfig({
        ...baseEnv,
        ALLOWED_EMAILS: 'me@example.com,friend@example.com',
        LEGACY_OWNER_EMAIL: ' Friend@Example.com ',
      })

      expect(config.legacyOwnerEmail).toBe('friend@example.com')
    })

    it('fails fast at load when several e-mails are allowlisted and no owner is set', () => {
      expect(() =>
        loadConfig({ ...baseEnv, ALLOWED_EMAILS: 'me@example.com,friend@example.com' }),
      ).toThrow(/LEGACY_OWNER_EMAIL/)
    })

    it('treats an empty LEGACY_OWNER_EMAIL (e.g. from docker compose) as unset', () => {
      expect(() =>
        loadConfig({
          ...baseEnv,
          ALLOWED_EMAILS: 'me@example.com,friend@example.com',
          LEGACY_OWNER_EMAIL: '',
        }),
      ).toThrow(/LEGACY_OWNER_EMAIL/)
      expect(loadConfig({ ...baseEnv, LEGACY_OWNER_EMAIL: '' }).legacyOwnerEmail).toBe(
        'me@example.com',
      )
    })

    it('rejects an owner who is not on the allowlist (they could never sign in to claim)', () => {
      expect(() =>
        loadConfig({ ...baseEnv, LEGACY_OWNER_EMAIL: 'stranger@example.com' }),
      ).toThrow(/LEGACY_OWNER_EMAIL/)
    })
  })

  it('treats NODE_ENV=production as requiring secure cookies', () => {
    const config = loadConfig({ ...baseEnv, NODE_ENV: 'production' })

    expect(config.cookieSecure).toBe(true)
  })
})

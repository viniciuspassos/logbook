import { loadConfig } from './configuration'

describe('loadConfig', () => {
  const baseEnv = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/logbook',
    GOOGLE_AUTH_ENABLED: 'true',
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
      googleAuthEnabled: true,
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
      googleAuthEnabled: true,
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

  describe('GOOGLE_AUTH_ENABLED feature flag', () => {
    const dbOnly = { DATABASE_URL: baseEnv.DATABASE_URL }

    it.each([
      ['true', true],
      ['TRUE', true],
      ['True', true],
      ['1', true],
      ['false', false],
      ['FALSE', false],
      ['0', false],
    ])('parses %p as %p', (raw, expected) => {
      const env = expected
        ? { ...baseEnv, GOOGLE_AUTH_ENABLED: raw }
        : { ...dbOnly, GOOGLE_AUTH_ENABLED: raw }

      expect(loadConfig(env).googleAuthEnabled).toBe(expected)
    })

    it.each(['yes', 'no', 'on', 'off', '2', 'enabled', ' '])(
      'throws a clear config error for the non-boolean value %p',
      (raw) => {
        expect(() => loadConfig({ ...baseEnv, GOOGLE_AUTH_ENABLED: raw })).toThrow(
          /GOOGLE_AUTH_ENABLED/,
        )
      },
    )

    it('defaults to false when unset or empty', () => {
      expect(loadConfig(dbOnly).googleAuthEnabled).toBe(false)
      expect(loadConfig({ ...dbOnly, GOOGLE_AUTH_ENABLED: '' }).googleAuthEnabled).toBe(false)
    })

    it('does not require or validate the Google vars when off', () => {
      const config = loadConfig({
        ...dbOnly,
        GOOGLE_AUTH_ENABLED: 'false',
      })

      expect(config).toMatchObject({
        googleAuthEnabled: false,
        googleClientId: '',
        allowedEmails: [],
      })
    })

    it('requires the Google vars when on', () => {
      expect(() =>
        loadConfig({ ...dbOnly, GOOGLE_AUTH_ENABLED: 'true' }),
      ).toThrow(/GOOGLE_CLIENT_ID/)
    })
  })

  it('treats NODE_ENV=production as requiring secure cookies', () => {
    const config = loadConfig({ ...baseEnv, NODE_ENV: 'production' })

    expect(config.cookieSecure).toBe(true)
  })
})

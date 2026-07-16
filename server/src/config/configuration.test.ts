import { loadConfig } from './configuration'

describe('loadConfig', () => {
  const baseEnv = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/logbook',
  }

  it('throws if DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/)
  })

  it('applies defaults when optional vars are absent', () => {
    const config = loadConfig(baseEnv)

    expect(config).toEqual({
      port: 3000,
      nodeEnv: 'development',
      databaseUrl: baseEnv.DATABASE_URL,
      uploadDir: expect.stringContaining('uploads'),
      maxUploadSizeBytes: 10 * 1024 * 1024,
    })
  })

  it('parses provided env vars over defaults', () => {
    const config = loadConfig({
      ...baseEnv,
      PORT: '4321',
      NODE_ENV: 'production',
      UPLOAD_DIR: '/data/uploads',
      MAX_UPLOAD_SIZE_BYTES: '2048',
    })

    expect(config).toEqual({
      port: 4321,
      nodeEnv: 'production',
      databaseUrl: baseEnv.DATABASE_URL,
      uploadDir: '/data/uploads',
      maxUploadSizeBytes: 2048,
    })
  })
})

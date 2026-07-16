import * as path from 'node:path'

export interface AppConfig {
  port: number
  nodeEnv: string
  databaseUrl: string
  uploadDir: string
  maxUploadSizeBytes: number
}

/** A minimal shape of process.env we actually read, so tests can pass a plain object. */
export type Env = Readonly<Record<string, string | undefined>>

const DEFAULT_PORT = 3000
const DEFAULT_MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024

/**
 * Parses and validates process.env into a typed AppConfig. Pure function (no
 * global process.env access unless the caller omits `env`) so it's trivial to
 * unit test with fake env objects instead of mutating global state.
 */
export function loadConfig(env: Env = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL environment variable is required (see server/.env.example).',
    )
  }

  return {
    port: env.PORT ? Number(env.PORT) : DEFAULT_PORT,
    nodeEnv: env.NODE_ENV ?? 'development',
    databaseUrl,
    uploadDir: env.UPLOAD_DIR ?? path.resolve(process.cwd(), 'uploads'),
    maxUploadSizeBytes: env.MAX_UPLOAD_SIZE_BYTES
      ? Number(env.MAX_UPLOAD_SIZE_BYTES)
      : DEFAULT_MAX_UPLOAD_SIZE_BYTES,
  }
}

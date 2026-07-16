import * as path from 'node:path'

export interface AppConfig {
  port: number
  nodeEnv: string
  databaseUrl: string
  uploadDir: string
  maxUploadSizeBytes: number
  /** scrypt hash of the single-user login password, see auth/password-hasher.service.ts. */
  authPasswordHash: string
  /** Session lifetime, extended (sliding) on use — see auth/sessions.service.ts. */
  sessionTtlDays: number
  /** Whether the `Secure` cookie attribute is set on session/CSRF cookies. */
  cookieSecure: boolean
}

/** A minimal shape of process.env we actually read, so tests can pass a plain object. */
export type Env = Readonly<Record<string, string | undefined>>

const DEFAULT_PORT = 3000
const DEFAULT_MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024
const DEFAULT_SESSION_TTL_DAYS = 30

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

  const authPasswordHash = env.AUTH_PASSWORD_HASH
  if (!authPasswordHash) {
    throw new Error(
      'AUTH_PASSWORD_HASH environment variable is required (see server/.env.example). ' +
        'Generate one with `npm run hash-password -- <password>`.',
    )
  }

  const nodeEnv = env.NODE_ENV ?? 'development'

  return {
    port: env.PORT ? Number(env.PORT) : DEFAULT_PORT,
    nodeEnv,
    databaseUrl,
    uploadDir: env.UPLOAD_DIR ?? path.resolve(process.cwd(), 'uploads'),
    maxUploadSizeBytes: env.MAX_UPLOAD_SIZE_BYTES
      ? Number(env.MAX_UPLOAD_SIZE_BYTES)
      : DEFAULT_MAX_UPLOAD_SIZE_BYTES,
    authPasswordHash,
    sessionTtlDays: env.SESSION_TTL_DAYS
      ? Number(env.SESSION_TTL_DAYS)
      : DEFAULT_SESSION_TTL_DAYS,
    cookieSecure: nodeEnv === 'production',
  }
}

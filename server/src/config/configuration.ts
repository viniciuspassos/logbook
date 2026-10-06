import * as path from 'node:path'

export interface AppConfig {
  port: number
  nodeEnv: string
  databaseUrl: string
  uploadDir: string
  maxUploadSizeBytes: number
  /** OAuth Web client ID a Google ID token's `aud` must equal, see auth/google-token-verifier.service.ts. */
  googleClientId: string
  /** Lowercased e-mail addresses allowed to sign in; anyone else gets 403. */
  allowedEmails: string[]
  /** Session lifetime, extended (sliding) on use — see auth/sessions.service.ts. */
  sessionTtlDays: number
  /** Whether the `Secure` cookie attribute is set on session/CSRF cookies. */
  cookieSecure: boolean
}

/** A minimal shape of process.env we actually read, so tests can pass a plain object. */
export type Env = Readonly<Record<string, string | undefined>>

const DEFAULT_PORT = 3000
// 25MB: iPhone ProRAW/HEIC photos run close to this size and were failing
// against the previous 10MB default. Still overridable via
// MAX_UPLOAD_SIZE_BYTES (see .env.example).
const DEFAULT_MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024
const DEFAULT_SESSION_TTL_DAYS = 30

const MAX_PORT = 65535

/**
 * Parses an optional numeric env var as a positive integer (at most `max`),
 * falling back to `fallback` when unset/empty. Throws at boot with the
 * variable's name instead of letting `Number('abc')` become a NaN that
 * silently breaks listening, session expiry or the upload limit later.
 */
function parsePositiveInt(
  name: string,
  raw: string | undefined,
  fallback: number,
  max: number = Number.MAX_SAFE_INTEGER,
): number {
  if (!raw) {
    return fallback
  }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(
      `${name} must be an integer between 1 and ${max}, got "${raw}" (see server/.env.example).`,
    )
  }
  return value
}

function parseAllowedEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0)
}

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

  const googleClientId = env.GOOGLE_CLIENT_ID
  if (!googleClientId) {
    throw new Error(
      'GOOGLE_CLIENT_ID environment variable is required (see server/.env.example).',
    )
  }

  const allowedEmails = parseAllowedEmails(env.ALLOWED_EMAILS)
  if (allowedEmails.length === 0) {
    throw new Error(
      'ALLOWED_EMAILS environment variable is required: a comma-separated list of ' +
        'e-mail addresses allowed to sign in (see server/.env.example).',
    )
  }

  const nodeEnv = env.NODE_ENV ?? 'development'

  return {
    port: parsePositiveInt('PORT', env.PORT, DEFAULT_PORT, MAX_PORT),
    nodeEnv,
    databaseUrl,
    uploadDir: env.UPLOAD_DIR ?? path.resolve(process.cwd(), 'uploads'),
    maxUploadSizeBytes: parsePositiveInt(
      'MAX_UPLOAD_SIZE_BYTES',
      env.MAX_UPLOAD_SIZE_BYTES,
      DEFAULT_MAX_UPLOAD_SIZE_BYTES,
    ),
    googleClientId,
    allowedEmails,
    sessionTtlDays: parsePositiveInt(
      'SESSION_TTL_DAYS',
      env.SESSION_TTL_DAYS,
      DEFAULT_SESSION_TTL_DAYS,
    ),
    cookieSecure: nodeEnv === 'production',
  }
}

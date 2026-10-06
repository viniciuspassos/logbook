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
  /**
   * Lowercased e-mail of the one user who inherits every entry/attachment with
   * no owner (everything written before accounts existed) when they first sign
   * in. Always one of `allowedEmails`; see resolveLegacyOwnerEmail.
   */
  legacyOwnerEmail: string
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
 * Parses an optional numeric env var as an integer in [min, max], falling
 * back to `fallback` when unset/empty. Throws at boot with the variable's
 * name instead of letting `Number('abc')` become a NaN that silently breaks
 * listening, session expiry or the upload limit later.
 */
function parseInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
  { min, max = Number.MAX_SAFE_INTEGER }: { min: number; max?: number },
): number {
  if (!raw) {
    return fallback
  }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `${name} must be an integer between ${min} and ${max}, got "${raw}" (see server/.env.example).`,
    )
  }
  return value
}

/**
 * Who inherits the pre-accounts (ownerless) rows. Unset means "the sole
 * allowlisted e-mail"; with several allowlisted addresses there is no safe
 * guess (the first to sign in could be the wrong person), so it must be set
 * explicitly and the app refuses to boot otherwise. A value that is not on
 * the allowlist could never sign in to claim anything, so that is an error too.
 */
function resolveLegacyOwnerEmail(raw: string | undefined, allowedEmails: string[]): string {
  const configured = raw?.trim().toLowerCase()
  if (!configured) {
    if (allowedEmails.length === 1) {
      return allowedEmails[0]
    }
    throw new Error(
      'LEGACY_OWNER_EMAIL is required when ALLOWED_EMAILS lists more than one address: ' +
        'it names the user who inherits the entries and photos that existed before accounts ' +
        '(see server/.env.example).',
    )
  }
  if (!allowedEmails.includes(configured)) {
    throw new Error(`LEGACY_OWNER_EMAIL (${configured}) must be one of ALLOWED_EMAILS.`)
  }
  return configured
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

  const legacyOwnerEmail = resolveLegacyOwnerEmail(env.LEGACY_OWNER_EMAIL, allowedEmails)

  const nodeEnv = env.NODE_ENV ?? 'development'

  return {
    // 0 is valid: the OS picks an ephemeral port (used by e2e/dev).
    port: parseInteger('PORT', env.PORT, DEFAULT_PORT, { min: 0, max: MAX_PORT }),
    nodeEnv,
    databaseUrl,
    uploadDir: env.UPLOAD_DIR ?? path.resolve(process.cwd(), 'uploads'),
    maxUploadSizeBytes: parseInteger(
      'MAX_UPLOAD_SIZE_BYTES',
      env.MAX_UPLOAD_SIZE_BYTES,
      DEFAULT_MAX_UPLOAD_SIZE_BYTES,
      { min: 1 },
    ),
    googleClientId,
    allowedEmails,
    legacyOwnerEmail,
    sessionTtlDays: parseInteger(
      'SESSION_TTL_DAYS',
      env.SESSION_TTL_DAYS,
      DEFAULT_SESSION_TTL_DAYS,
      { min: 1 },
    ),
    cookieSecure: nodeEnv === 'production',
  }
}

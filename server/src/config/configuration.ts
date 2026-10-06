import * as path from 'node:path'

export interface AppConfig {
  port: number
  nodeEnv: string
  databaseUrl: string
  uploadDir: string
  maxUploadSizeBytes: number
  /**
   * Feature flag (`GOOGLE_AUTH_ENABLED`, default false). Off means no sign-in
   * route and therefore no session: the API stays closed. The three Google
   * settings below are only required (and validated) when this is on; when
   * off they are '' / [].
   */
  googleAuthEnabled: boolean
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

type GoogleSettings = Pick<AppConfig, 'googleClientId' | 'allowedEmails' | 'legacyOwnerEmail'>

const DISABLED_GOOGLE_SETTINGS: GoogleSettings = {
  googleClientId: '',
  allowedEmails: [],
  legacyOwnerEmail: '',
}

/** Reads and validates the Google settings, which only matter (and are only required) when the flag is on. */
function loadGoogleSettings(env: Env): GoogleSettings {
  const googleClientId = env.GOOGLE_CLIENT_ID
  if (!googleClientId) {
    throw new Error(
      'GOOGLE_CLIENT_ID environment variable is required when GOOGLE_AUTH_ENABLED is true ' +
        '(see server/.env.example).',
    )
  }

  const allowedEmails = parseAllowedEmails(env.ALLOWED_EMAILS)
  if (allowedEmails.length === 0) {
    throw new Error(
      'ALLOWED_EMAILS environment variable is required when GOOGLE_AUTH_ENABLED is true: a ' +
        'comma-separated list of e-mail addresses allowed to sign in (see server/.env.example).',
    )
  }

  return {
    googleClientId,
    allowedEmails,
    legacyOwnerEmail: resolveLegacyOwnerEmail(env.LEGACY_OWNER_EMAIL, allowedEmails),
  }
}

/**
 * Strict boolean env var: 'true'/'1' or 'false'/'0', case-insensitive; unset
 * or empty means false. Anything else (including 'yes', 'on') throws, so a
 * typo can't silently leave login off — or on.
 */
function parseBoolean(name: string, raw: string | undefined): boolean {
  if (raw === undefined || raw === '') {
    return false
  }
  const value = raw.trim().toLowerCase()
  if (value === 'true' || value === '1') {
    return true
  }
  if (value === 'false' || value === '0') {
    return false
  }
  throw new Error(`${name} must be true, false, 1 or 0, got "${raw}" (see server/.env.example).`)
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

  const googleAuthEnabled = parseBoolean('GOOGLE_AUTH_ENABLED', env.GOOGLE_AUTH_ENABLED)
  const google = googleAuthEnabled ? loadGoogleSettings(env) : DISABLED_GOOGLE_SETTINGS

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
    googleAuthEnabled,
    ...google,
    sessionTtlDays: parseInteger(
      'SESSION_TTL_DAYS',
      env.SESSION_TTL_DAYS,
      DEFAULT_SESSION_TTL_DAYS,
      { min: 1 },
    ),
    cookieSecure: nodeEnv === 'production',
  }
}

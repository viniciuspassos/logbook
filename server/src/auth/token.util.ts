import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'

const TOKEN_BYTES = 32

/** A cryptographically random, URL-safe opaque token (session or CSRF token). */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex')
}

/**
 * One-way hash of an opaque token for storage (e.g. a session token in the
 * `sessions` table): the raw token lives only in the client's cookie, so a
 * database read/leak alone can't be replayed as a valid session cookie.
 * Unlike a password hash this doesn't need to be slow (the input already has
 * 256 bits of entropy, so it isn't brute-forceable) — a fast, deterministic
 * digest is the right tool here.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Constant-time string comparison for secrets (CSRF token check). Guards
 * against a naive `===` leaking how many leading characters matched via
 * response-time differences.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufferA = Buffer.from(a)
  const bufferB = Buffer.from(b)
  if (bufferA.length !== bufferB.length) {
    return false
  }
  return timingSafeEqual(bufferA, bufferB)
}

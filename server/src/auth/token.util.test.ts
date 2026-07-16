import { generateToken, hashToken, timingSafeEqualStrings } from './token.util'

describe('generateToken', () => {
  it('returns a 64-character hex string (32 random bytes)', () => {
    const token = generateToken()

    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns a different value on each call', () => {
    expect(generateToken()).not.toBe(generateToken())
  })
})

describe('hashToken', () => {
  it('is deterministic for the same input', () => {
    const token = generateToken()

    expect(hashToken(token)).toBe(hashToken(token))
  })

  it('produces different hashes for different tokens', () => {
    expect(hashToken(generateToken())).not.toBe(hashToken(generateToken()))
  })

  it('does not return the raw token', () => {
    const token = generateToken()

    expect(hashToken(token)).not.toBe(token)
  })
})

describe('timingSafeEqualStrings', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqualStrings('same-value', 'same-value')).toBe(true)
  })

  it('returns false for different strings of the same length', () => {
    expect(timingSafeEqualStrings('aaaaaaaaaa', 'bbbbbbbbbb')).toBe(false)
  })

  it('returns false for strings of different lengths', () => {
    expect(timingSafeEqualStrings('short', 'a-much-longer-string')).toBe(false)
  })
})

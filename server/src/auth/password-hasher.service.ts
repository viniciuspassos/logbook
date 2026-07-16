import { Injectable } from '@nestjs/common'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

const ALGORITHM_TAG = 'scrypt'
const SALT_BYTES = 16
const KEY_LENGTH = 64
// Node's crypto.scrypt defaults to N=16384 (2^14), r=8, p=1 when no `options`
// object is passed — that's already at OWASP's recommended minimum work
// factor, so it's recorded in the stored hash (for future-proofing a cost
// bump) without needing to be passed explicitly on every call.
const COST_FACTOR = 16384

/**
 * Hashes and verifies the single-user login password with scrypt (Node's
 * built-in `crypto.scrypt`), chosen over bcrypt/argon2 specifically to avoid
 * adding a native-addon dependency to the server's Docker build — scrypt is
 * a memory-hard KDF built into Node itself and is an OWASP-acceptable choice
 * when argon2id isn't available.
 *
 * Stored format: `scrypt$<costFactor>$<saltHex>$<hashHex>` — self-describing
 * so a future cost-factor bump doesn't invalidate hashes already on disk.
 */
@Injectable()
export class PasswordHasherService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES)
    const derivedKey = await this.derive(password, salt, KEY_LENGTH)
    return [ALGORITHM_TAG, COST_FACTOR, salt.toString('hex'), derivedKey.toString('hex')].join(
      '$',
    )
  }

  async verify(password: string, storedHash: string): Promise<boolean> {
    const parsed = this.parse(storedHash)
    if (!parsed) {
      return false
    }

    const derivedKey = await this.derive(password, parsed.salt, parsed.hash.length)
    if (derivedKey.length !== parsed.hash.length) {
      return false
    }
    return timingSafeEqual(derivedKey, parsed.hash)
  }

  private parse(storedHash: string): { salt: Buffer; hash: Buffer } | null {
    const parts = storedHash.split('$')
    if (parts.length !== 4 || parts[0] !== ALGORITHM_TAG) {
      return null
    }
    const [, , saltHex, hashHex] = parts
    if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) {
      return null
    }
    return { salt: Buffer.from(saltHex, 'hex'), hash: Buffer.from(hashHex, 'hex') }
  }

  private async derive(password: string, salt: Buffer, keyLength: number): Promise<Buffer> {
    const derivedKey = await scryptAsync(password, salt, keyLength)
    return derivedKey as Buffer
  }
}

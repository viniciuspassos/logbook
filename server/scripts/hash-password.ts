import 'reflect-metadata'
import { PasswordHasherService } from '../src/auth/password-hasher.service'

/**
 * CLI entrypoint, not TDD'd like the rest of the app (same exception as
 * main.ts): it's a thin wrapper printing the output of an already-tested
 * pure function (PasswordHasherService.hash), not business logic itself.
 *
 * Usage: npm run hash-password -- "<your password>"
 * Paste the printed value into AUTH_PASSWORD_HASH in server/.env (never
 * commit the plaintext password anywhere, including shell history if this
 * machine is shared — prefer being prompted interactively for anything
 * beyond local dev).
 */
async function main(): Promise<void> {
  const password = process.argv[2]
  if (!password) {
    console.error('Usage: npm run hash-password -- "<your password>"')
    process.exitCode = 1
    return
  }

  const hash = await new PasswordHasherService().hash(password)
  console.log(hash)
}

main().catch((error: unknown) => {
  console.error('Failed to hash password:', error)
  process.exitCode = 1
})

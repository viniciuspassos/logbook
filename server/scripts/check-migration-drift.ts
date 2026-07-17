import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import * as path from 'node:path'
import { isUnexpectedMigrationGenerateFailure } from '../src/database/migration-drift.util'

/**
 * CLI entrypoint, not TDD'd like the rest of the app (same exception as
 * hash-password.ts / main.ts): it's a thin wrapper around
 * isUnexpectedMigrationGenerateFailure, which is the actually-tested logic
 * (see src/database/migration-drift.util.test.ts).
 *
 * Run in CI (see .github/workflows/ci-static.yml, job
 * server-migrations-drift) against a real Postgres already migrated up to
 * the committed migrations. Fails the job unless either:
 *  - migration:generate exits 0 (it wrote a new migration — the file-count
 *    check below still fails the job in that case), or
 *  - it exits non-zero specifically because there is no drift to report.
 * Any other non-zero exit (bad invocation, connection drop, etc.) fails
 * loudly instead of being swallowed by a blanket `|| true`.
 */
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'database', 'migrations')

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).sort()
}

function main(): void {
  const before = listMigrationFiles()

  const result = spawnSync(
    'npm',
    ['run', 'migration:generate', '--', 'src/database/migrations/DriftCheck'],
    { encoding: 'utf8' },
  )
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  console.log(output)
  if (result.error) {
    // spawnSync failed to launch the process at all (e.g. npm missing from
    // PATH) — surface that distinctly, since stdout/stderr above will be
    // empty and give no clue why exitCode came back non-zero.
    console.error(result.error)
  }

  const exitCode = result.status ?? 1
  if (isUnexpectedMigrationGenerateFailure(exitCode, output)) {
    console.error(
      `::error::migration:generate failed unexpectedly (exit ${exitCode}) rather than reporting "no drift". See output above.`,
    )
    process.exitCode = 1
    return
  }

  const after = listMigrationFiles()
  if (after.length !== before.length) {
    const newFiles = after.filter((file) => !before.includes(file))
    console.error(
      "::error::Entities and migrations have drifted. Run 'npm run migration:generate' locally against a real Postgres, review the generated migration, and commit it — see docs/INFRASTRUCTURE.md.",
    )
    console.error(`New migration file(s) generated: ${newFiles.join(', ')}`)
    process.exitCode = 1
    return
  }

  console.log('No drift detected between entities and committed migrations.')
}

main()

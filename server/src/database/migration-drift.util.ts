/**
 * TypeORM's `migration:generate` CLI exits 1 (deliberately, per TypeORM)
 * when there is NO drift to report — "No changes in database schema were
 * found" is the success case for a drift check, not a failure. A blanket
 * `|| true` around that command would also swallow every *other* non-zero
 * exit (a bad CLI invocation, a dropped DB connection, etc.), reporting a
 * false "no drift" green instead of a real failure.
 *
 * This distinguishes the two: only the documented "no drift" message
 * paired with a non-zero exit counts as expected; anything else non-zero
 * is a genuine, unexpected failure that must fail the job loudly.
 */
export const NO_DRIFT_MESSAGE = 'No changes in database schema were found'

export function isUnexpectedMigrationGenerateFailure(exitCode: number, output: string): boolean {
  if (exitCode === 0) {
    return false
  }

  return !output.includes(NO_DRIFT_MESSAGE)
}

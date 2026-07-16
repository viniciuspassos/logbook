import * as path from 'node:path'

/**
 * Glob TypeORM uses to discover migration files, resolved relative to this
 * module's own directory (`__dirname`) rather than `process.cwd()`. That
 * makes it correct whichever way the app is run: `ts-node` against `src/`
 * (dev, `start:dev`, the CLI DataSource) or the compiled output under
 * `dist/` (production, `node dist/main.js`) — both mirror the same
 * `database/migrations` layout, so this single expression works for both
 * without an env-based branch.
 */
export function migrationsGlob(): string {
  return path.join(__dirname, 'migrations', '*.{js,ts}')
}

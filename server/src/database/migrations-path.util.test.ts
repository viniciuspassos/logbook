import * as path from 'node:path'
import { migrationsGlob } from './migrations-path.util'

describe('migrationsGlob', () => {
  it('returns a glob rooted at this module directory, matching .js and .ts migration files', () => {
    const glob = migrationsGlob()

    expect(glob).toBe(path.join(__dirname, 'migrations', '*.{js,ts}'))
  })

  it('resolves under a database/migrations path so it is independent of process.cwd()', () => {
    const glob = migrationsGlob()

    expect(glob.startsWith(path.sep)).toBe(true)
    expect(glob).toContain(`${path.sep}database${path.sep}migrations${path.sep}`)
  })
})

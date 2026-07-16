import { buildCliDataSourceOptions } from './cli-data-source.options'
import { migrationsGlob } from './migrations-path.util'
import { allEntities } from './entities'

describe('buildCliDataSourceOptions', () => {
  it('targets postgres using the given connection string', () => {
    const options = buildCliDataSourceOptions('postgres://user:pass@localhost:5432/logbook')

    expect(options.type).toBe('postgres')
    expect(options).toMatchObject({ url: 'postgres://user:pass@localhost:5432/logbook' })
  })

  it('lists every entity explicitly, since the CLI runs outside Nest DI', () => {
    const options = buildCliDataSourceOptions('postgres://user:pass@localhost:5432/logbook')

    expect(options.entities).toBe(allEntities)
  })

  it('points migrations at the shared migrations glob', () => {
    const options = buildCliDataSourceOptions('postgres://user:pass@localhost:5432/logbook')

    expect(options.migrations).toEqual([migrationsGlob()])
  })

  it('never auto-syncs schema, even for CLI usage', () => {
    const options = buildCliDataSourceOptions('postgres://user:pass@localhost:5432/logbook')

    expect(options.synchronize).toBe(false)
  })
})

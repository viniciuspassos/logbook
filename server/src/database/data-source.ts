import 'reflect-metadata'
import * as dotenv from 'dotenv'
import { DataSource } from 'typeorm'
import { buildCliDataSourceOptions } from './cli-data-source.options'

// The running app loads `.env` via @nestjs/config's ConfigModule (see
// config/config.module.ts), which never runs here: the TypeORM CLI
// (`npm run migration:*`, see package.json) imports this file directly,
// outside Nest entirely, so it has to load `.env` itself.
dotenv.config()

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL environment variable is required to run TypeORM CLI commands ' +
      '(see server/.env.example). Set it in server/.env or the shell environment.',
  )
}

/**
 * DataSource consumed exclusively by the TypeORM CLI, wired up via the
 * `-d src/database/data-source.ts` flag baked into the `typeorm` npm
 * script. Not used by the running app — that goes through Nest's DI via
 * database.module.ts / typeorm.config.ts instead. See
 * cli-data-source.options.ts for the (unit-tested) connection options this
 * wraps.
 */
export default new DataSource(buildCliDataSourceOptions(databaseUrl))

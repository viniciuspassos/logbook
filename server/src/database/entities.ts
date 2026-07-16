import { Entry } from '../entries/entry.entity'
import { Attachment } from '../attachments/attachment.entity'
import { Session } from '../auth/session.entity'

/**
 * Every TypeORM entity in this app, as a single explicit list. The running
 * app doesn't need this — `typeorm.config.ts` sets `autoLoadEntities: true`
 * so Nest's DI container discovers entities from each module's
 * `TypeOrmModule.forFeature()` registration instead. The TypeORM CLI
 * (`data-source.ts`) runs outside Nest entirely, though, so `migration:generate`
 * has no DI container to discover entities from — it needs this list to know
 * what schema the entities actually describe. Kept as one file so adding a
 * new entity is one line here, not a search for every place entities are
 * enumerated.
 */
export const allEntities = [Entry, Attachment, Session]

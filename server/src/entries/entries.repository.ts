import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { IsNull, type QueryDeepPartialEntity, type Repository } from 'typeorm'
import { Entry, type SupersededEntryEdit } from './entry.entity'
import { Attachment } from '../attachments/attachment.entity'
import type { UpdateEntryDto } from './dto/update-entry.dto'

/**
 * Outcome of an optimistic-concurrency update (#24) — a discriminated union
 * rather than throwing from inside the repository, so EntriesService (the
 * layer that owns translating outcomes into HTTP exceptions) decides what
 * each case means at the API boundary, the same separation the rest of this
 * repository already keeps (`null` for "not found" on other methods).
 */
export type EntryUpdateResult =
  | { outcome: 'not-found' }
  | { outcome: 'conflict'; current: Entry }
  | { outcome: 'updated'; entry: Entry }

/**
 * Thin wrapper around TypeORM's Repository<Entry> — the only place in the
 * entries feature that imports `typeorm` directly. EntriesService and
 * EntriesController never touch the ORM; they only see this class's plain
 * async methods, matching the frontend's `lib/db` wrapper pattern.
 */
@Injectable()
export class EntriesRepository {
  constructor(@InjectRepository(Entry) private readonly orm: Repository<Entry>) {}

  findAll(): Promise<Entry[]> {
    return this.orm.find({ where: { deletedAt: IsNull() }, order: { id: 'DESC' } })
  }

  findById(id: number): Promise<Entry | null> {
    return this.orm.findOneBy({ id, deletedAt: IsNull() })
  }

  async create(
    data: Omit<
      Entry,
      'id' | 'version' | 'deletedAt' | 'supersededEdits' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<Entry> {
    const draft = this.orm.create({ ...data, version: 1, deletedAt: null, supersededEdits: null })
    return this.orm.save(draft)
  }

  /**
   * Optimistic-concurrency update (#24). Reads the current row to answer
   * `not-found` and to build the 409 body / the `supersededEdits` history,
   * but the actual write is a **conditional UPDATE** — `WHERE id = :id AND
   * version = :baseVersion AND deletedAt IS NULL` — not a read-then-save. A
   * transaction alone does not make a separate read-compare-write atomic
   * under Postgres's default READ COMMITTED isolation: two requests can
   * both read the same `version`, both pass an in-application check, and
   * the second `save()` would silently clobber the first with its own
   * stale value (a lost update, no 409, no error). Putting `version` in the
   * UPDATE's own WHERE clause closes that gap without a lock: if a
   * concurrent writer commits first, Postgres re-evaluates the WHERE
   * clause against the now-current row before applying this one, so the
   * predicate on the old `version` no longer matches and this UPDATE
   * affects zero rows — verified to behave the same way against the sqljs
   * driver this app's tests run on (see the "guards against a racing
   * writer" test in entries.repository.test.ts), so this needs no
   * driver-conditional code path.
   *
   * Outcomes:
   *  - `not-found` (no write) if the entry doesn't exist or is already
   *    tombstoned at the initial read;
   *  - `conflict` with the current row (no write applied) if the initial
   *    read already shows a version mismatch, *or* if the conditional
   *    UPDATE affects zero rows because a racing writer won between our
   *    read and our write (re-read to get the row a second time in that
   *    case; downgraded to `not-found` if that racing writer's change was
   *    itself a delete);
   *  - `updated` with the freshly re-read row otherwise — a plain
   *    `UpdateResult` doesn't carry the updated column values back, so a
   *    follow-up read is needed regardless of how the write happened.
   */
  async update(id: number, dto: UpdateEntryDto): Promise<EntryUpdateResult> {
    return this.orm.manager.transaction(async (manager) => {
      const existing = await manager.findOneBy(Entry, { id, deletedAt: IsNull() })
      if (!existing) {
        return { outcome: 'not-found' }
      }
      if (existing.version !== dto.version) {
        return { outcome: 'conflict', current: existing }
      }

      const baseVersion = existing.version
      const { version: _version, supersededEdit, ...changes } = dto

      const columnChanges: QueryDeepPartialEntity<Entry> = {
        ...changes,
        version: baseVersion + 1,
      }
      if (supersededEdit) {
        const loser: SupersededEntryEdit = {
          version: baseVersion,
          capturedAt: new Date().toISOString(),
          data: supersededEdit,
        }
        columnChanges.supersededEdits = [...(existing.supersededEdits ?? []), loser]
      }

      const result = await manager.update(
        Entry,
        { id, version: baseVersion, deletedAt: IsNull() },
        columnChanges,
      )

      if ((result.affected ?? 0) === 0) {
        // Lost the race: something else wrote (or tombstoned) this row
        // between our read above and the conditional UPDATE just now.
        const current = await manager.findOneBy(Entry, { id })
        if (!current || current.deletedAt) {
          return { outcome: 'not-found' }
        }
        return { outcome: 'conflict', current }
      }

      const entry = await manager.findOneByOrFail(Entry, { id })
      return { outcome: 'updated', entry }
    })
  }

  /**
   * Deletes an Entry's Attachment rows and tombstones the Entry row itself,
   * in a single DB transaction (#24 reworks #20's cascade: attachment rows
   * are still hard-deleted — the underlying files are still cleaned up
   * best-effort by the caller afterwards, outside this transaction, see
   * EntriesService.remove — but the Entry row now survives with `deletedAt`
   * set rather than being removed, so tombstones can propagate on sync
   * instead of the row simply disappearing). Returns the deleted Attachment
   * rows so the caller knows which storage keys to clean up, or `null` if
   * the entry didn't exist or was already tombstoned, in which case nothing
   * was changed.
   *
   * This reaches directly into the Attachment entity via the shared
   * EntityManager instead of composing AttachmentsRepository: two
   * independently-injected repositories can't be made to share one
   * transaction without a lot more plumbing, and doing so here keeps
   * EntriesModule and AttachmentsModule from needing to import each other
   * (AttachmentsModule already imports EntriesModule for its own
   * entry-existence check on upload; adding the reverse edge would make
   * that a circular module dependency).
   */
  async removeCascade(id: number): Promise<Attachment[] | null> {
    return this.orm.manager.transaction(async (manager) => {
      const entry = await manager.findOneBy(Entry, { id, deletedAt: IsNull() })
      if (!entry) {
        return null
      }
      const attachments = await manager.findBy(Attachment, { entryId: id })
      await manager.delete(Attachment, { entryId: id })
      entry.deletedAt = new Date()
      await manager.save(Entry, entry)
      return attachments
    })
  }
}

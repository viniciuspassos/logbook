import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { IsNull, type Repository } from 'typeorm'
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
   * Optimistic-concurrency update (#24). Reads the current row, compares
   * `dto.version` against it, and:
   *  - returns `not-found` (no write) if the entry doesn't exist or is
   *    already tombstoned;
   *  - returns `conflict` with the untouched current row (no write) if
   *    `dto.version` doesn't match — the caller (EntriesService) turns this
   *    into a 409 carrying that row, see EntryVersionConflictException;
   *  - otherwise applies the change, bumps `version` by one, optionally
   *    appends `dto.supersededEdit` to the preserved-losers history, and
   *    saves — returning `updated` with the saved row.
   *
   * Wrapped in a transaction so the read-compare-write sequence is atomic
   * against a concurrent update racing on the same row, matching
   * removeCascade's use of a transaction below for the same reason.
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

      // Captured before merge: TypeORM's manager.merge() mutates
      // `mergeIntoEntity` (here, `existing`) in place and returns that same
      // reference — so `existing.version` would already reflect the bumped
      // value below if read afterwards, corrupting the loser's recorded
      // base version.
      const baseVersion = existing.version
      const priorSupersededEdits = existing.supersededEdits

      const { version: _version, supersededEdit, ...changes } = dto
      const merged = manager.merge<Entry>(Entry, existing, changes)
      merged.version = baseVersion + 1

      if (supersededEdit) {
        const loser: SupersededEntryEdit = {
          version: baseVersion,
          capturedAt: new Date().toISOString(),
          data: supersededEdit,
        }
        merged.supersededEdits = [...(priorSupersededEdits ?? []), loser]
      }

      const saved = await manager.save(Entry, merged)
      return { outcome: 'updated', entry: saved }
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

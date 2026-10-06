import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository, SelectQueryBuilder } from 'typeorm'
import { Entry } from '../entries/entry.entity'
import { Attachment } from './attachment.entity'

/**
 * Thin wrapper around TypeORM's Repository<Attachment>, same pattern as
 * EntriesRepository.
 *
 * Every read/delete resolves ownership through the *parent entry's* owner
 * (an inner join on `entries.userId`, tombstoned entries excluded), not the
 * attachment's own nullable `userId`: the entry is the unit of ownership, so a legacy attachment whose
 * own `userId` was never set stays reachable by whoever owns its entry, and
 * can never be reached by anyone else. (The join is a query-builder join on
 * the plain `entryId` column, not a TypeORM relation — see the note on
 * Attachment for why `entryId` stays a plain column.)
 */
@Injectable()
export class AttachmentsRepository {
  constructor(
    @InjectRepository(Attachment) private readonly orm: Repository<Attachment>,
  ) {}

  findByEntryId(entryId: number, userId: number): Promise<Attachment[]> {
    return this.ownedBy(userId)
      .andWhere('attachment.entryId = :entryId', { entryId })
      .orderBy('attachment.id', 'DESC')
      .getMany()
  }

  findById(id: number, userId: number): Promise<Attachment | null> {
    return this.ownedBy(userId).andWhere('attachment.id = :id', { id }).getOne()
  }

  async create(data: Omit<Attachment, 'id' | 'createdAt'>): Promise<Attachment> {
    const draft = this.orm.create(data)
    return this.orm.save(draft)
  }

  /**
   * One ownership-scoped DELETE: the attachment goes only if its parent entry
   * is owned by `userId` and not tombstoned, checked inside the same
   * statement, so there is no separate lookup to race against. The owned-entry
   * subquery is built with the query builder and its parameters are carried
   * over to the DELETE (bound, never interpolated). Returns whether a row was
   * actually deleted, which callers must use to decide whether to touch the
   * stored blob.
   */
  async remove(id: number, userId: number): Promise<boolean> {
    const ownedEntries = this.orm
      .createQueryBuilder()
      .subQuery()
      .select('owned.id')
      .from(Entry, 'owned')
      .where('owned.userId = :userId', { userId })
      .andWhere('owned.deletedAt IS NULL')
    const result = await this.orm
      .createQueryBuilder()
      .delete()
      .from(Attachment)
      .where('id = :id', { id })
      // A DELETE has no entity alias for TypeORM to resolve `entryId` through,
      // so the one column is quoted by hand (standard SQL, same on sqlite/Postgres).
      .andWhere(`"entryId" IN ${ownedEntries.getQuery()}`)
      .setParameters(ownedEntries.getParameters())
      .execute()
    return (result.affected ?? 0) > 0
  }

  private ownedBy(userId: number): SelectQueryBuilder<Attachment> {
    // `entry.deletedAt IS NULL` is explicit (not left to TypeORM's implicit
    // soft-delete handling of joins): an attachment of a tombstoned entry is
    // as gone as the entry, matching what upload already answers (404).
    return this.orm
      .createQueryBuilder('attachment')
      .innerJoin(Entry, 'entry', 'entry.id = attachment.entryId')
      .where('entry.userId = :userId', { userId })
      .andWhere('entry.deletedAt IS NULL')
  }
}

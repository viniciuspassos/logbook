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
 * (an inner join on `entries.userId`), not the attachment's own nullable
 * `userId`: the entry is the unit of ownership, so a legacy attachment whose
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

  async remove(id: number, userId: number): Promise<boolean> {
    const owned = await this.findById(id, userId)
    if (!owned) {
      return false
    }
    const result = await this.orm.delete(id)
    return (result.affected ?? 0) > 0
  }

  private ownedBy(userId: number): SelectQueryBuilder<Attachment> {
    return this.orm
      .createQueryBuilder('attachment')
      .innerJoin(Entry, 'entry', 'entry.id = attachment.entryId')
      .where('entry.userId = :userId', { userId })
  }
}

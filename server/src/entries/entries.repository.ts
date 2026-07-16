import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository } from 'typeorm'
import { Entry } from './entry.entity'
import { Attachment } from '../attachments/attachment.entity'

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
    return this.orm.find({ order: { id: 'DESC' } })
  }

  findById(id: number): Promise<Entry | null> {
    return this.orm.findOneBy({ id })
  }

  async create(data: Omit<Entry, 'id' | 'createdAt' | 'updatedAt'>): Promise<Entry> {
    const draft = this.orm.create(data)
    return this.orm.save(draft)
  }

  async update(id: number, changes: Partial<Entry>): Promise<Entry | null> {
    const existing = await this.orm.findOneBy({ id })
    if (!existing) {
      return null
    }
    const merged = this.orm.merge(existing, changes)
    return this.orm.save(merged)
  }

  /**
   * Cascade-deletes an Entry and all of its Attachment rows in a single DB
   * transaction (the "rows-first" half of #20's cascade-delete decision —
   * the underlying attachment files are deleted best-effort by the caller
   * afterwards, deliberately outside this transaction; see
   * EntriesService.remove). Returns the deleted Attachment rows so the
   * caller knows which storage keys to clean up, or `null` if the entry
   * didn't exist, in which case nothing was deleted.
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
      const entry = await manager.findOneBy(Entry, { id })
      if (!entry) {
        return null
      }
      const attachments = await manager.findBy(Attachment, { entryId: id })
      await manager.delete(Attachment, { entryId: id })
      await manager.delete(Entry, id)
      return attachments
    })
  }
}

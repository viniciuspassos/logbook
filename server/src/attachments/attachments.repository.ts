import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository } from 'typeorm'
import { Attachment } from './attachment.entity'

/** Thin wrapper around TypeORM's Repository<Attachment>, same pattern as EntriesRepository. */
@Injectable()
export class AttachmentsRepository {
  constructor(
    @InjectRepository(Attachment) private readonly orm: Repository<Attachment>,
  ) {}

  findByEntryId(entryId: number): Promise<Attachment[]> {
    return this.orm.find({ where: { entryId }, order: { id: 'DESC' } })
  }

  findById(id: number): Promise<Attachment | null> {
    return this.orm.findOneBy({ id })
  }

  async create(data: Omit<Attachment, 'id' | 'createdAt'>): Promise<Attachment> {
    const draft = this.orm.create(data)
    return this.orm.save(draft)
  }

  async remove(id: number): Promise<boolean> {
    const result = await this.orm.delete(id)
    return (result.affected ?? 0) > 0
  }
}

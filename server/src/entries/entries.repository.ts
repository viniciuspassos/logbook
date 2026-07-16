import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository } from 'typeorm'
import { Entry } from './entry.entity'

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

  async remove(id: number): Promise<boolean> {
    const result = await this.orm.delete(id)
    return (result.affected ?? 0) > 0
  }
}

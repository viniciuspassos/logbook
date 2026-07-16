import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository } from 'typeorm'
import { Session } from './session.entity'

/** Thin wrapper around TypeORM's Repository<Session>, same pattern as EntriesRepository. */
@Injectable()
export class SessionsRepository {
  constructor(@InjectRepository(Session) private readonly orm: Repository<Session>) {}

  findByTokenHash(tokenHash: string): Promise<Session | null> {
    return this.orm.findOneBy({ tokenHash })
  }

  async create(data: Omit<Session, 'id' | 'createdAt'>): Promise<Session> {
    const draft = this.orm.create(data)
    return this.orm.save(draft)
  }

  async updateExpiresAt(id: number, expiresAt: Date): Promise<void> {
    await this.orm.update(id, { expiresAt })
  }

  async removeById(id: number): Promise<void> {
    await this.orm.delete(id)
  }

  async removeByTokenHash(tokenHash: string): Promise<void> {
    await this.orm.delete({ tokenHash })
  }
}

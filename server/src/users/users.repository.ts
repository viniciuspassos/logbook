import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { IsNull, type Repository } from 'typeorm'
import { Attachment } from '../attachments/attachment.entity'
import { Entry } from '../entries/entry.entity'
import { User } from './user.entity'

export type UserProfile = Pick<User, 'email' | 'name' | 'picture'>
export type NewUser = UserProfile & Pick<User, 'googleSub'>

/** Thin wrapper around TypeORM's Repository<User>, same pattern as EntriesRepository. */
@Injectable()
export class UsersRepository {
  constructor(@InjectRepository(User) private readonly orm: Repository<User>) {}

  findByGoogleSub(googleSub: string): Promise<User | null> {
    return this.orm.findOneBy({ googleSub })
  }

  findById(id: number): Promise<User | null> {
    return this.orm.findOneBy({ id })
  }

  async updateProfile(id: number, profile: UserProfile): Promise<void> {
    await this.orm.update(id, profile)
  }

  /**
   * Creates the user and, when they turn out to be the only user, hands every
   * entry and attachment that has no owner (`userId IS NULL` — everything
   * written before accounts existed) to them. Both happen in one transaction
   * so a failed claim never leaves a user behind who silently lost the
   * legacy data to a retry. Reaches into the Entry/Attachment entities via
   * the shared EntityManager for the same reason EntriesRepository
   * .removeCascade does: one transaction across tables without a circular
   * module dependency. Later users never match `count === 1`, so they cannot
   * take rows away from the first.
   */
  async createClaimingLegacyRowsIfFirst(data: NewUser): Promise<User> {
    return this.orm.manager.transaction(async (manager) => {
      const user = await manager.save(manager.create(User, data))
      const userCount = await manager.count(User)
      if (userCount === 1) {
        await manager.update(Entry, { userId: IsNull() }, { userId: user.id })
        await manager.update(Attachment, { userId: IsNull() }, { userId: user.id })
      }
      return user
    })
  }
}

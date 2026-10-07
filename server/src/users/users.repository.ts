import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository } from 'typeorm'
import { User } from './user.entity'

export type UserProfile = Pick<User, 'email' | 'name' | 'picture'>
export type NewUser = UserProfile & Pick<User, 'googleSub'>

/** Thin wrapper around TypeORM's Repository<User>, same pattern as EntriesRepository. */
@Injectable()
export class UsersRepository {
  constructor(@InjectRepository(User) private readonly orm: Repository<User>) {}

  findById(id: number): Promise<User | null> {
    return this.orm.findOneBy({ id })
  }

  async updateProfile(id: number, profile: UserProfile): Promise<void> {
    await this.orm.update(id, profile)
  }

  /**
   * Returns the user with this Google `sub`, inserting it first if missing.
   * Two first sign-ins of the same account can both pass the "not found" read
   * and both INSERT; the loser hits the unique `googleSub`. Only the insert is
   * guarded: on failure it re-reads by `sub` and returns the racer's user if
   * it exists, otherwise rethrows the original error, so a real failure is
   * never masked.
   */
  async findOrCreate(data: NewUser): Promise<User> {
    const existing = await this.orm.findOneBy({ googleSub: data.googleSub })
    if (existing) {
      return existing
    }
    try {
      return await this.orm.save(this.orm.create(data))
    } catch (error) {
      const racer = await this.orm.findOneBy({ googleSub: data.googleSub })
      if (racer) {
        return racer
      }
      throw error
    }
  }
}

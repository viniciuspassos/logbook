import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { IsNull, type EntityManager, type Repository } from 'typeorm'
import { Attachment } from '../attachments/attachment.entity'
import { Entry } from '../entries/entry.entity'
import { User } from './user.entity'

export type UserProfile = Pick<User, 'email' | 'name' | 'picture'>
export type NewUser = UserProfile & Pick<User, 'googleSub'>

/** Arbitrary constant key identifying the "create a user" critical section. */
const USER_CREATION_LOCK_KEY = 7_240_122

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
   * Returns the user with this Google `sub`, creating it first if needed. When
   * it creates the user and `claimLegacyRows` is set, it also hands every
   * entry and attachment that has no owner (`userId IS NULL` — everything
   * written before accounts existed) to them. Creation and claim happen in
   * one transaction, so a failed claim never leaves a user behind who
   * silently lost the legacy data to a retry. Who may claim is the caller's
   * decision (the configured legacy owner only, see UsersService); this
   * method only guarantees it happens at most once, with the creation.
   *
   * Under READ COMMITTED two sign-ins of the same new account would both try
   * to insert (one losing to the unique `googleSub` with a 500). So the
   * transaction first takes a Postgres transaction-scoped advisory lock:
   * concurrent callers queue up and each re-reads under the lock, which makes
   * the call idempotent per `sub`. (sql.js, used only in tests, is
   * single-connection, so no lock is needed there.)
   *
   * Reaches into the Entry/Attachment entities via the shared EntityManager
   * for the same reason EntriesRepository.removeCascade does: one transaction
   * across tables without a circular module dependency.
   */
  async findOrCreate(data: NewUser, options: { claimLegacyRows: boolean }): Promise<User> {
    return this.orm.manager.transaction(async (manager) => {
      await serializeUserCreation(manager)

      const existing = await manager.findOneBy(User, { googleSub: data.googleSub })
      if (existing) {
        return existing
      }

      const user = await manager.save(manager.create(User, data))
      if (options.claimLegacyRows) {
        await manager.update(Entry, { userId: IsNull() }, { userId: user.id })
        await manager.update(Attachment, { userId: IsNull() }, { userId: user.id })
      }
      return user
    })
  }
}

async function serializeUserCreation(manager: EntityManager): Promise<void> {
  if (manager.connection.options.type === 'postgres') {
    await manager.query('SELECT pg_advisory_xact_lock($1::bigint)', [USER_CREATION_LOCK_KEY])
  }
}

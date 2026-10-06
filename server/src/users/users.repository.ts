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
   * `claimLegacyRows` is set it then hands every entry and attachment that
   * still has no owner (`userId IS NULL` — everything written before accounts
   * existed) to that user. The claim is an idempotent step, run on every
   * sign-in of the legacy owner, not only when their row is created: it is a
   * cheap no-op when nothing is left, and it still works when another user
   * signed in first, when the owner already had a row, or when
   * LEGACY_OWNER_EMAIL later names someone else. It can never take a row away
   * from anyone, because it only touches rows whose `userId IS NULL`. Who may
   * claim is the caller's decision (UsersService); creation and claim share
   * one transaction.
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

      const user =
        (await manager.findOneBy(User, { googleSub: data.googleSub })) ??
        (await manager.save(manager.create(User, data)))
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

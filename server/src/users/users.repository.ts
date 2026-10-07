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
   * Returns the user with this Google `sub`, creating it first if needed. When
   * `claimLegacyRows` is set it then hands every entry and attachment that
   * still has no owner (`userId IS NULL` — everything written before accounts
   * existed) to that user. The claim is an idempotent step, run on every
   * sign-in of the legacy owner, not only when their row is created: it is a
   * cheap no-op when nothing is left, and it works when another user signed in
   * first, when the owner already had a row, or when LEGACY_OWNER_EMAIL later
   * names someone else. It can never take a row away from anyone, because it
   * only touches rows whose `userId IS NULL`. Who may claim is the caller's
   * decision (UsersService); creation and claim share one transaction.
   *
   * Two sign-ins of the same new account can both pass the "not found" read
   * and both INSERT; one then loses to the unique `googleSub`. That is
   * handled by catching the failure *outside* the transaction (Postgres aborts
   * the whole transaction on a unique violation, so nothing can be re-read
   * inside it): if the user exists now, the racer created it, and a fresh
   * transaction finds it (and still runs the claim). If it still does not
   * exist, the error was something else and is rethrown.
   */
  async findOrCreate(data: NewUser, options: { claimLegacyRows: boolean }): Promise<User> {
    try {
      return await this.findOrCreateInTransaction(data, options)
    } catch (error) {
      if (!(await this.orm.findOneBy({ googleSub: data.googleSub }))) {
        throw error
      }
      return this.findOrCreateInTransaction(data, options)
    }
  }

  /**
   * Reaches into the Entry/Attachment entities via the shared EntityManager
   * for the same reason EntriesRepository.removeCascade does: one transaction
   * across tables without a circular module dependency.
   */
  private findOrCreateInTransaction(
    data: NewUser,
    options: { claimLegacyRows: boolean },
  ): Promise<User> {
    return this.orm.manager.transaction(async (manager) => {
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

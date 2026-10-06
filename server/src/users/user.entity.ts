import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/**
 * An account created the first time an allowlisted Google identity signs in.
 *
 * Identity is keyed on Google's stable `sub` claim (`googleSub`), never on
 * the e-mail: an e-mail address can change or be recycled, `sub` cannot. The
 * e-mail, name and picture are a profile snapshot refreshed on each sign-in
 * (see UsersService.findOrCreateFromGoogle).
 *
 * `name`/`picture` are plain nullable varchar columns so the same entity
 * works on the Postgres production driver and the sql.js driver the tests use.
 */
@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ unique: true })
  googleSub!: string

  /**
   * Always stored trimmed and lowercased (UsersService). Indexed but
   * deliberately NOT unique: a recycled address (the same e-mail now held by a
   * different Google account, i.e. a different `sub`) must not lock a new
   * legitimate user out. Identity is `googleSub`; the e-mail is only the
   * allowlist/legacy-owner key.
   */
  @Index()
  @Column()
  email!: string

  @Column({ type: 'varchar', nullable: true })
  name!: string | null

  @Column({ type: 'varchar', nullable: true })
  picture!: string | null

  @CreateDateColumn()
  createdAt!: Date
}

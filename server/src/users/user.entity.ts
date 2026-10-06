import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'

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

  @Column()
  email!: string

  @Column({ type: 'varchar', nullable: true })
  name!: string | null

  @Column({ type: 'varchar', nullable: true })
  picture!: string | null

  @CreateDateColumn()
  createdAt!: Date
}

import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'

/**
 * A server-side session row backing the httpOnly session cookie. Chosen over
 * an in-memory session store specifically because this app already has a
 * hard Postgres dependency (entries/attachments) and the whole point of a
 * long-lived session (see SessionsService) is to survive a field trip with
 * no connectivity — losing every session on a container restart/redeploy
 * would undermine that. See server's auth report for the full tradeoff.
 *
 * Only a hash of the raw session token is stored (see auth/token.util.ts):
 * the raw token lives solely in the client's httpOnly cookie, so a database
 * read/leak alone can't be replayed as a valid session.
 */
@Entity({ name: 'sessions' })
export class Session {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ unique: true })
  tokenHash!: string

  /** Bound to this session; checked against the X-CSRF-Token header on mutating requests. */
  @Column()
  csrfToken!: string

  @Column()
  expiresAt!: Date

  @CreateDateColumn()
  createdAt!: Date
}

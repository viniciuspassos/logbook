import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

export const ADVENTURE_SHAPES = ['circle', 'triangle', 'diamond'] as const
export type AdventureShape = (typeof ADVENTURE_SHAPES)[number]

/**
 * Server-side persistence model for a Logbook entry. Field-for-field mirrors
 * the frontend's `Entry` shape (src/types/entry.ts) so the schema stays
 * realistic, but this is an independent server DTO/entity — the frontend
 * package is never imported here, and this pass does not sync the two.
 *
 * `media` is stored as `simple-json` (works identically across the Postgres
 * production driver and the sqlite/sql.js driver used in tests) rather than
 * a Postgres-only `jsonb` column, so entities behave the same under both.
 */
@Entity({ name: 'entries' })
export class Entry {
  @PrimaryGeneratedColumn()
  id!: number

  @Column()
  title!: string

  @Column({ type: 'varchar' })
  shape!: AdventureShape

  @Column({ type: 'varchar', nullable: true })
  activityType?: string

  @Column()
  location!: string

  @Column()
  date!: string

  @Column()
  metric!: string

  @Column()
  excerpt!: string

  @Column()
  weather!: string

  @Column()
  duration!: string

  @Column()
  difficulty!: string

  @Column()
  equipment!: string

  @Column()
  participants!: string

  @Column({ type: 'text' })
  raw!: string

  @Column({ type: 'text' })
  story!: string

  @Column()
  photoHint!: string

  @Column({ type: 'simple-json' })
  media!: [string, string, string]

  @Column({ type: 'float' })
  mapX!: number

  @Column({ type: 'float' })
  mapY!: number

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}

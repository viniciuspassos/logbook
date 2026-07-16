import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

export const ADVENTURE_SHAPES = ['circle', 'triangle', 'diamond'] as const
export type AdventureShape = (typeof ADVENTURE_SHAPES)[number]

/**
 * A single losing edit preserved by #24's optimistic-concurrency conflict
 * handling. When an update's `version` doesn't match the entry's current
 * version, the server rejects the write with 409 and hands back the current
 * row (see EntryVersionConflictException) rather than silently discarding
 * either side. If the client resolves the conflict and resubmits, it may
 * attach its own losing draft as `supersededEdit` on that follow-up PATCH
 * (see UpdateEntryDto) — the server appends it here rather than dropping it.
 * The server never reads or interprets `data`: per #24's decision, "the
 * server's job is to detect the conflict ... and store whatever the client
 * stashes", not to run its own merge policy.
 */
export interface SupersededEntryEdit {
  /** The entry's version at the moment this losing edit was recorded — i.e.
   *  the version the client's local edit failed to overwrite. */
  version: number
  /** ISO-8601 timestamp of when the *server* recorded this loser (not a
   *  client-supplied time — see the `updatedAt` warning below on why this
   *  entity never trusts a client's clock for ordering). */
  capturedAt: string
  /** Opaque snapshot of the fields the losing edit attempted to write. */
  data: Partial<EditableEntryFields>
}

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

  /**
   * Reserved for a future multi-user migration (see server/src/auth for the
   * current single-user auth model). Always null today — nothing writes it —
   * but having the column now means that migration needs no backfill against
   * live data.
   */
  @Column({ type: 'int', nullable: true })
  userId?: number | null

  /**
   * Optimistic-concurrency counter (#24). Starts at 1 on create and is
   * incremented server-side on every successful update — never by a client.
   * An update whose submitted `version` doesn't match this column's current
   * value is rejected with 409 rather than applied (see EntriesRepository.update
   * and EntryVersionConflictException); the write never happens, so this
   * column only ever moves forward on a write that actually occurred.
   */
  @Column({ type: 'int', default: 1 })
  version!: number

  /**
   * Losing edits preserved across version conflicts — see the
   * SupersededEntryEdit docstring above. `simple-json` for the same
   * sqlite/Postgres portability reason as `media`; nullable and `null` by
   * default so the overwhelmingly common no-conflict case (this app is
   * single-user, per #18 — a same-entry conflict needs one person editing
   * from two devices with one offline) costs nothing extra to read.
   */
  @Column({ type: 'simple-json', nullable: true })
  supersededEdits?: SupersededEntryEdit[] | null

  /**
   * Soft-delete tombstone (#24). `DELETE /entries/:id` sets this rather than
   * removing the row — a hard delete would be invisible to a device holding
   * an offline copy, which could re-push the entry on its next sync and
   * resurrect it (see #20/#23). `null` means "not deleted".
   *
   * `@DeleteDateColumn` (rather than a plain `@Column`) for the same
   * cross-driver portability reason `@CreateDateColumn`/`@UpdateDateColumn`
   * below use it: TypeORM resolves its actual SQL type per-driver
   * (`timestamp` on Postgres, `datetime` on sqlite/sqljs) instead of one
   * hardcoded type string that only one of the two supports. This
   * repository never calls TypeORM's own `softDelete()`/`restore()` helpers
   * or relies on the automatic "exclude soft-deleted rows" behaviour
   * `@DeleteDateColumn` enables on `find()`/`findOne()` — every read path
   * (findAll/findById, and anything built on findById, e.g. the attachment
   * entry-existence check) filters `deletedAt IS NULL` explicitly instead,
   * so it stays a deliberate, auditable check rather than ORM magic a future
   * reader has to know about. A place to forget that filter is a place a
   * deleted entry reappears. Purging tombstoned rows is deliberately
   * deferred — see the PR description for #24 — this column only ever gets
   * *set*, nothing currently clears it.
   */
  @DeleteDateColumn()
  deletedAt?: Date | null

  @CreateDateColumn()
  createdAt!: Date

  /**
   * Set by the *server* on write — records when the server heard about a
   * change, not when the user made it. A write queued offline for days and
   * synced later gets today's timestamp here. This is exactly why #24 uses
   * `version` rather than this column as the conflict clock — never resolve
   * a conflict, order edits, or reintroduce last-write-wins by comparing
   * `updatedAt` values.
   */
  @UpdateDateColumn()
  updatedAt!: Date
}

/** The subset of Entry's own fields a client edit can touch — the same set
 *  CreateEntryDto validates, and the shape of a losing edit's snapshot
 *  stashed in `supersededEdits` above. */
export type EditableEntryFields = Pick<
  Entry,
  | 'title'
  | 'shape'
  | 'activityType'
  | 'location'
  | 'date'
  | 'metric'
  | 'excerpt'
  | 'weather'
  | 'duration'
  | 'difficulty'
  | 'equipment'
  | 'participants'
  | 'raw'
  | 'story'
  | 'photoHint'
  | 'media'
  | 'mapX'
  | 'mapY'
>

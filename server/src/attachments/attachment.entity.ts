import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'

/**
 * Metadata row for an uploaded file, associated with an Entry by id (a
 * plain foreign-key column, not a TypeORM relation) — the actual file bytes
 * never live here, only a `storageKey` the FileStorage abstraction can
 * resolve back to them. See docs on FileStorage in storage/storage.interface.ts.
 *
 * Deleting an Entry cascade-deletes its Attachments (#20): the attachment
 * rows and the entry row are removed together in one DB transaction
 * (EntriesRepository.removeCascade), then each attachment's underlying file
 * is deleted best-effort (a file-delete failure is logged, never thrown —
 * see EntriesService.remove). This is purely an application-layer cascade.
 *
 * #21 revisited whether to add a DB-level `ON DELETE CASCADE` FK constraint
 * now that migrations exist, and deliberately decided against it:
 * `entryId` staying a plain column (not a TypeORM relation) is itself a
 * decision, not an oversight — EntriesRepository.removeCascade reaches
 * directly into this entity via a shared EntityManager specifically so
 * EntriesModule and AttachmentsModule don't need a circular import (see the
 * docstring there). Modeling a real `@ManyToOne`/`@JoinColumn` relation here
 * to get a FK constraint would mean either duplicating `entryId` behind a
 * `@RelationId` (a real behavior change for every repository/service method
 * that reads or filters on `entryId` today) or accepting an unmodeled
 * constraint that TypeORM's own entity metadata doesn't know about — which
 * would itself register as drift the very first time `migration:generate`
 * runs, defeating the CI drift check #21 added. `removeCascade` is also
 * verifiably the *only* code path that deletes an Entry row (grep for
 * `manager.delete(Entry` / `.delete(Entry`), so a DB constraint would only
 * guard against a future bug that bypasses the repository layer entirely —
 * real defense in depth, but not worth the relation refactor today. Revisit
 * if Attachment ever needs a real `@ManyToOne` relation for other reasons
 * (e.g. eager-loading), at which point the FK constraint becomes close to
 * free.
 */
@Entity({ name: 'attachments' })
export class Attachment {
  @PrimaryGeneratedColumn()
  id!: number

  @Column()
  entryId!: number

  @Column()
  originalFilename!: string

  @Column()
  storageKey!: string

  @Column()
  mimeType!: string

  @Column({ type: 'int' })
  sizeBytes!: number

  /**
   * Reserved for a future multi-user migration (see server/src/auth for the
   * current single-user auth model). Always null today — nothing writes it —
   * but having the column now means that migration needs no backfill against
   * live data.
   */
  @Column({ type: 'int', nullable: true })
  userId?: number | null

  @CreateDateColumn()
  createdAt!: Date
}

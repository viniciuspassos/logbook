import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'

/**
 * Metadata row for an uploaded file, associated with an Entry by id (a
 * plain foreign-key column, not a TypeORM relation) — the actual file bytes
 * never live here, only a `storageKey` the FileStorage abstraction can
 * resolve back to them. See docs on FileStorage in storage/storage.interface.ts.
 *
 * NOTE (deferred, flagged for a human decision): deleting an Entry does not
 * currently cascade-delete its Attachments or their underlying files — see
 * the PR description / final summary for why, and the product question this
 * raises (cascade vs. orphan vs. block-delete-if-attachments-exist).
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

  @CreateDateColumn()
  createdAt!: Date
}

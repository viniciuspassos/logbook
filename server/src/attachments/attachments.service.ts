import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import { AttachmentsRepository } from './attachments.repository'
import { EntriesRepository } from '../entries/entries.repository'
import {
  FILE_STORAGE,
  StorageFileNotFoundError,
  type FileStorage,
  type SaveFileInput,
} from '../storage/storage.interface'
import { ALLOWED_IMAGE_MIME_TYPES, detectImageType } from './image-type'
import type { Attachment } from './attachment.entity'
import type { ContentDispositionType } from '../common/http/content-disposition'

export interface UploadedFile {
  buffer: Buffer
  originalFilename: string
}

export interface AttachmentFile {
  attachment: Attachment
  buffer: Buffer
  /** Derived from the stored bytes' magic number, never from a client- or
   *  DB-stored declared type — see getFile(). */
  contentType: string
  disposition: ContentDispositionType
}

/**
 * Business logic for uploading/listing/reading/removing attachments. Neither
 * TypeORM nor the filesystem/storage backend is touched directly here — both
 * are behind the AttachmentsRepository and FileStorage seams so this class
 * stays a plain orchestrator, testable with mocks (see attachments.service.test.ts).
 */
@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name)

  constructor(
    private readonly attachmentsRepository: AttachmentsRepository,
    private readonly entriesRepository: EntriesRepository,
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStorage,
  ) {}

  async uploadForEntry(entryId: number, file: UploadedFile): Promise<Attachment> {
    await this.assertEntryExists(entryId)

    // The client-declared Content-Type (Multer's file.mimetype) is never
    // read here — it's attacker-controlled and trivially spoofed. The only
    // type that's ever trusted is what the file's own magic bytes say (#19).
    const detectedMimeType = detectImageType(file.buffer)
    if (!detectedMimeType) {
      throw new UnsupportedMediaTypeException(
        `Unsupported file type. Allowed types: ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}.`,
      )
    }

    const saveInput: SaveFileInput = {
      buffer: file.buffer,
      originalFilename: file.originalFilename,
      mimeType: detectedMimeType,
    }
    const stored = await this.fileStorage.save(saveInput)

    return this.attachmentsRepository.create({
      entryId,
      originalFilename: file.originalFilename,
      storageKey: stored.key,
      mimeType: detectedMimeType,
      sizeBytes: stored.sizeBytes,
    })
  }

  async listForEntry(entryId: number): Promise<Attachment[]> {
    await this.assertEntryExists(entryId)
    return this.attachmentsRepository.findByEntryId(entryId)
  }

  async getMetadata(id: number): Promise<Attachment> {
    return this.requireAttachment(id)
  }

  async getFile(id: number): Promise<AttachmentFile> {
    const attachment = await this.requireAttachment(id)
    try {
      const buffer = await this.fileStorage.read(attachment.storageKey)
      // Re-sniff the actual stored bytes rather than trusting the DB's
      // mimeType column: it may hold a pre-#19 client-declared value (a row
      // uploaded before this validation existed) that must never drive what
      // gets served as this response's Content-Type. Anything that doesn't
      // match an allowlisted image signature is downgraded to an opaque,
      // forced download so it can never be rendered in-origin.
      const detectedMimeType = detectImageType(buffer)
      return {
        attachment,
        buffer,
        contentType: detectedMimeType ?? 'application/octet-stream',
        disposition: detectedMimeType ? 'inline' : 'attachment',
      }
    } catch (error) {
      if (error instanceof StorageFileNotFoundError) {
        throw new NotFoundException(`Attachment ${id} has no stored file`)
      }
      throw error
    }
  }

  /**
   * Removes the metadata row first, then deletes the underlying file
   * best-effort — the same rows-first ordering as the entry-cascade path in
   * EntriesService.remove, so both delete paths for this resource give the
   * same consistency guarantee (#35, per #20's decision).
   *
   * A file-delete failure is logged and swallowed, never thrown: otherwise a
   * transient disk error (EACCES/EIO — LocalDiskStorageService only swallows
   * ENOENT) would make the attachment permanently undeletable, since every
   * retry fails identically. A stranded file is a harmless disk artifact
   * that #22's storage work can sweep; an undeletable row is not.
   */
  async remove(id: number): Promise<void> {
    const attachment = await this.requireAttachment(id)
    await this.attachmentsRepository.remove(id)

    try {
      await this.fileStorage.delete(attachment.storageKey)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.logger.warn(
        `Failed to delete file for attachment ${id} ` +
          `(storageKey="${attachment.storageKey}") after removing its row: ${reason}`,
      )
    }
  }

  private async requireAttachment(id: number): Promise<Attachment> {
    const attachment = await this.attachmentsRepository.findById(id)
    if (!attachment) {
      throw new NotFoundException(`Attachment ${id} not found`)
    }
    return attachment
  }

  private async assertEntryExists(entryId: number): Promise<void> {
    const entry = await this.entriesRepository.findById(entryId)
    if (!entry) {
      throw new NotFoundException(`Entry ${entryId} not found`)
    }
  }
}

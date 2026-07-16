import { Inject, Injectable, NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common'
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

  async remove(id: number): Promise<void> {
    const attachment = await this.requireAttachment(id)
    await this.fileStorage.delete(attachment.storageKey)
    await this.attachmentsRepository.remove(id)
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

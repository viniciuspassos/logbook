import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { AttachmentsRepository } from './attachments.repository'
import { EntriesRepository } from '../entries/entries.repository'
import {
  FILE_STORAGE,
  StorageFileNotFoundError,
  type FileStorage,
  type SaveFileInput,
} from '../storage/storage.interface'
import type { Attachment } from './attachment.entity'

export interface UploadedFile {
  buffer: Buffer
  originalFilename: string
  mimeType: string
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

    const saveInput: SaveFileInput = {
      buffer: file.buffer,
      originalFilename: file.originalFilename,
      mimeType: file.mimeType,
    }
    const stored = await this.fileStorage.save(saveInput)

    return this.attachmentsRepository.create({
      entryId,
      originalFilename: file.originalFilename,
      storageKey: stored.key,
      mimeType: file.mimeType,
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

  async getFile(id: number): Promise<{ attachment: Attachment; buffer: Buffer }> {
    const attachment = await this.requireAttachment(id)
    try {
      const buffer = await this.fileStorage.read(attachment.storageKey)
      return { attachment, buffer }
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

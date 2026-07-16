import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { EntriesRepository } from './entries.repository'
import { EntryVersionConflictException } from './entry-version-conflict.exception'
import { FILE_STORAGE, type FileStorage } from '../storage/storage.interface'
import type { Entry } from './entry.entity'
import type { CreateEntryDto } from './dto/create-entry.dto'
import type { UpdateEntryDto } from './dto/update-entry.dto'

@Injectable()
export class EntriesService {
  private readonly logger = new Logger(EntriesService.name)

  constructor(
    private readonly entriesRepository: EntriesRepository,
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStorage,
  ) {}

  findAll(): Promise<Entry[]> {
    return this.entriesRepository.findAll()
  }

  async findOne(id: number): Promise<Entry> {
    const entry = await this.entriesRepository.findById(id)
    if (!entry) {
      throw new NotFoundException(`Entry ${id} not found`)
    }
    return entry
  }

  create(dto: CreateEntryDto): Promise<Entry> {
    return this.entriesRepository.create(dto)
  }

  /**
   * Optimistic-concurrency update (#24). `dto.version` must match the
   * entry's current version or the write is rejected outright — see
   * EntriesRepository.update for the read-compare-write mechanics.
   */
  async update(id: number, dto: UpdateEntryDto): Promise<Entry> {
    const result = await this.entriesRepository.update(id, dto)
    switch (result.outcome) {
      case 'not-found':
        throw new NotFoundException(`Entry ${id} not found`)
      case 'conflict':
        throw new EntryVersionConflictException(result.current)
      case 'updated':
        return result.entry
    }
  }

  /**
   * Cascade-deletes the entry: the entry row and its attachment rows are
   * removed together in one DB transaction (EntriesRepository.removeCascade),
   * then each removed attachment's underlying file is deleted best-effort.
   * A file-delete failure is logged and swallowed, never thrown — the API
   * stays consistent (rows are always gone once this resolves) and a
   * stranded file is a harmless disk artifact #22's storage work can sweep
   * later. See issue #20.
   */
  async remove(id: number): Promise<void> {
    const deletedAttachments = await this.entriesRepository.removeCascade(id)
    if (deletedAttachments === null) {
      throw new NotFoundException(`Entry ${id} not found`)
    }

    await Promise.all(
      deletedAttachments.map(async (attachment) => {
        try {
          await this.fileStorage.delete(attachment.storageKey)
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          this.logger.warn(
            `Failed to delete file for attachment ${attachment.id} ` +
              `(storageKey="${attachment.storageKey}") after cascading delete of entry ${id}: ${reason}`,
          )
        }
      }),
    )
  }
}

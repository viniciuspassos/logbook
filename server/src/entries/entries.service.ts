import { Injectable, NotFoundException } from '@nestjs/common'
import { EntriesRepository } from './entries.repository'
import type { Entry } from './entry.entity'
import type { CreateEntryDto } from './dto/create-entry.dto'
import type { UpdateEntryDto } from './dto/update-entry.dto'

@Injectable()
export class EntriesService {
  constructor(private readonly entriesRepository: EntriesRepository) {}

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

  async update(id: number, dto: UpdateEntryDto): Promise<Entry> {
    const updated = await this.entriesRepository.update(id, dto)
    if (!updated) {
      throw new NotFoundException(`Entry ${id} not found`)
    }
    return updated
  }

  async remove(id: number): Promise<void> {
    const removed = await this.entriesRepository.remove(id)
    if (!removed) {
      throw new NotFoundException(`Entry ${id} not found`)
    }
  }
}

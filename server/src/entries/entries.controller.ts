import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common'
import { CurrentUserId } from '../auth/current-user.decorator'
import { EntriesService } from './entries.service'
import { CreateEntryDto } from './dto/create-entry.dto'
import { UpdateEntryDto } from './dto/update-entry.dto'
import type { Entry } from './entry.entity'

/**
 * Thin HTTP layer: routes + validation (via the DTOs' class-validator
 * decorators, enforced by the global ValidationPipe in main.ts) + delegation
 * to EntriesService. No database or filesystem access happens here.
 */
@Controller('entries')
export class EntriesController {
  constructor(private readonly entriesService: EntriesService) {}

  @Get()
  findAll(@CurrentUserId() userId: number): Promise<Entry[]> {
    return this.entriesService.findAll(userId)
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUserId() userId: number,
  ): Promise<Entry> {
    return this.entriesService.findOne(id, userId)
  }

  @Post()
  create(@Body() dto: CreateEntryDto, @CurrentUserId() userId: number): Promise<Entry> {
    return this.entriesService.create(userId, dto)
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEntryDto,
    @CurrentUserId() userId: number,
  ): Promise<Entry> {
    return this.entriesService.update(id, userId, dto)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUserId() userId: number,
  ): Promise<void> {
    return this.entriesService.remove(id, userId)
  }
}

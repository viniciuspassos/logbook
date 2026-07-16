import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { AttachmentsService } from './attachments.service'
import type { Attachment } from './attachment.entity'

/**
 * Upload/list routes nested under an entry: POST/GET /entries/:entryId/attachments.
 * The actual file bytes are received into memory (see attachments.module.ts's
 * MulterModule config) and handed to AttachmentsService, which is the only
 * thing that talks to the FileStorage abstraction.
 */
@Controller('entries/:entryId/attachments')
export class EntryAttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('entryId', ParseIntPipe) entryId: number,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<Attachment> {
    if (!file) {
      throw new BadRequestException('A "file" multipart field is required')
    }
    return this.attachmentsService.uploadForEntry(entryId, {
      buffer: file.buffer,
      originalFilename: file.originalname,
      mimeType: file.mimetype,
    })
  }

  @Get()
  list(@Param('entryId', ParseIntPipe) entryId: number): Promise<Attachment[]> {
    return this.attachmentsService.listForEntry(entryId)
  }
}

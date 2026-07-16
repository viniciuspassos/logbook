import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Res,
} from '@nestjs/common'
import type { Response } from 'express'
import { AttachmentsService } from './attachments.service'
import type { Attachment } from './attachment.entity'

/** Attachment-id-addressed routes: metadata, raw file bytes, delete. */
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Get(':id')
  metadata(@Param('id', ParseIntPipe) id: number): Promise<Attachment> {
    return this.attachmentsService.getMetadata(id)
  }

  @Get(':id/file')
  async file(@Param('id', ParseIntPipe) id: number, @Res() res: Response): Promise<void> {
    const { attachment, buffer } = await this.attachmentsService.getFile(id)
    res.setHeader('Content-Type', attachment.mimeType)
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${attachment.originalFilename}"`,
    )
    res.send(buffer)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.attachmentsService.remove(id)
  }
}

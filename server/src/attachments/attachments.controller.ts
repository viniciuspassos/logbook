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
import { buildContentDisposition } from '../common/http/content-disposition'
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
    const { attachment, buffer, contentType, disposition } =
      await this.attachmentsService.getFile(id)

    // Belt-and-braces: even though contentType/disposition are already
    // trustworthy (derived from the stored bytes' magic number, never a
    // client- or DB-declared value — see AttachmentsService.getFile), tell
    // the browser not to MIME-sniff the response and override them (#19).
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Type', contentType)
    res.setHeader(
      'Content-Disposition',
      buildContentDisposition(disposition, attachment.originalFilename),
    )
    res.send(buffer)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.attachmentsService.remove(id)
  }
}

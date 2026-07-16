import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { MulterModule } from '@nestjs/platform-express'
import { TypeOrmModule } from '@nestjs/typeorm'
import { memoryStorage } from 'multer'
import type { AppConfig } from '../config/configuration'
import { EntriesModule } from '../entries/entries.module'
import { Attachment } from './attachment.entity'
import { AttachmentsRepository } from './attachments.repository'
import { AttachmentsService } from './attachments.service'
import { AttachmentsController } from './attachments.controller'
import { EntryAttachmentsController } from './entry-attachments.controller'

@Module({
  imports: [
    TypeOrmModule.forFeature([Attachment]),
    // EntriesModule is imported (not just EntriesRepository re-provided) so
    // AttachmentsService can verify an entry exists before accepting an
    // upload for it, using the same repository instance.
    EntriesModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        // Buffered in memory, not written straight to disk by multer itself,
        // so AttachmentsService/FileStorage stays the single place that
        // decides where bytes end up (local disk today, S3 later).
        storage: memoryStorage(),
        limits: {
          fileSize: configService.getOrThrow<AppConfig>('app').maxUploadSizeBytes,
        },
      }),
    }),
  ],
  controllers: [EntryAttachmentsController, AttachmentsController],
  providers: [AttachmentsRepository, AttachmentsService],
})
export class AttachmentsModule {}

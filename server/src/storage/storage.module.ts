import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AppConfig } from '../config/configuration'
import { LocalDiskStorageService } from './local-disk-storage.service'
import { FILE_STORAGE } from './storage.interface'

/**
 * Binds the FILE_STORAGE token to LocalDiskStorageService today. Swapping to
 * an S3-compatible backend later is a one-line change here (new provider
 * class implementing FileStorage) — no other module references
 * LocalDiskStorageService directly, only the FILE_STORAGE interface.
 */
@Global()
@Module({
  providers: [
    {
      provide: FILE_STORAGE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new LocalDiskStorageService({
          uploadDir: configService.getOrThrow<AppConfig>('app').uploadDir,
        }),
    },
  ],
  exports: [FILE_STORAGE],
})
export class StorageModule {}

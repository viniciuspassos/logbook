import { Module } from '@nestjs/common'
import { ConfigModule } from './config/config.module'
import { DatabaseModule } from './database/database.module'
import { StorageModule } from './storage/storage.module'
import { HealthModule } from './health/health.module'
import { EntriesModule } from './entries/entries.module'
import { AttachmentsModule } from './attachments/attachments.module'

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    StorageModule,
    HealthModule,
    EntriesModule,
    AttachmentsModule,
  ],
})
export class AppModule {}

import { Module } from '@nestjs/common'
import { ConfigModule } from './config/config.module'
import { DatabaseModule } from './database/database.module'
import { StorageModule } from './storage/storage.module'
import { HealthModule } from './health/health.module'
import { AuthModule } from './auth/auth.module'
import { EntriesModule } from './entries/entries.module'
import { AttachmentsModule } from './attachments/attachments.module'

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    StorageModule,
    HealthModule,
    // AuthModule registers the global SessionAuthGuard/CsrfGuard (APP_GUARD
    // providers) — it must be imported for every route in every other
    // module below to actually be protected. See auth/auth.module.ts.
    AuthModule,
    EntriesModule,
    AttachmentsModule,
  ],
})
export class AppModule {}

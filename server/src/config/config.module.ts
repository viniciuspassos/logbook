import { Module } from '@nestjs/common'
import { ConfigModule as NestConfigModule } from '@nestjs/config'
import { loadConfig } from './configuration'

/**
 * Wraps @nestjs/config with this app's loadConfig() factory, namespaced under
 * "app" so `ConfigService.get<AppConfig>('app')` returns the whole typed
 * object instead of Nest's config module merging individual keys at the root.
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      load: [() => ({ app: loadConfig() })],
    }),
  ],
})
export class ConfigModule {}

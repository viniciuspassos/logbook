import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { AllExceptionsFilter } from './common/filters/http-exception.filter'
import type { AppConfig } from './config/configuration'

// AUTH SEAM (deferred, see common/auth/no-op-auth.guard.ts): a future auth
// pass would typically call `app.useGlobalGuards(new RealAuthGuard(...))`
// here. No global guard is registered in this pass — every route below is
// unauthenticated by design.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  app.useGlobalFilters(new AllExceptionsFilter())

  const configService = app.get(ConfigService)
  const { port } = configService.getOrThrow<AppConfig>('app')

  await app.listen(port)
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to start logbook-server:', error)
  process.exitCode = 1
})

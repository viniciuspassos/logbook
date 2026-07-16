import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import cookieParser from 'cookie-parser'
import { AppModule } from './app.module'
import { AllExceptionsFilter } from './common/filters/http-exception.filter'
import type { AppConfig } from './config/configuration'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)

  // Required for SessionAuthGuard/CsrfGuard/AuthController to read the
  // session and CSRF cookies off `req.cookies` (see auth/cookies.ts) —
  // Nest/Express don't parse cookies by default.
  app.use(cookieParser())

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

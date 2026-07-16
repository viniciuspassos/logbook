import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import type { Request, Response } from 'express'

interface ErrorPayload {
  statusCode: number
  timestamp: string
  path: string
  message: string | object
}

/**
 * Single global error boundary: known HttpExceptions (NotFoundException,
 * BadRequestException, validation errors, ...) pass their status/message
 * through as-is. Anything else (a thrown Error, a rejected promise with a
 * non-Error value, ...) is logged server-side with full detail but the
 * client only ever sees a generic 500 body — internal error messages
 * (stack traces, DB errors, etc.) must never leak into an API response.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()

    const isHttpException = exception instanceof HttpException
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR
    const message: string | object = isHttpException
      ? exception.getResponse()
      : 'Internal server error'

    if (!isHttpException) {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      )
    }

    const payload: ErrorPayload = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    }

    response.status(status).json(payload)
  }
}

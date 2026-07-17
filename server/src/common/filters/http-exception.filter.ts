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
  message: string | string[]
  [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/**
 * Single global error boundary: known HttpExceptions (NotFoundException,
 * BadRequestException, validation errors, ...) pass their status/message
 * through as-is. Anything else (a thrown Error, a rejected promise with a
 * non-Error value, ...) is logged server-side with full detail but the
 * client only ever sees a generic 500 body — internal error messages
 * (stack traces, DB errors, etc.) must never leak into an API response.
 *
 * `HttpException#getResponse()` can return either a plain string or an
 * object (Nest's own exceptions build `{ statusCode, message, error }`;
 * the global ValidationPipe's BadRequestException builds `message` as a
 * string[] of per-field errors; custom exceptions may add their own
 * fields, e.g. EntryVersionConflictException's `currentEntry`).
 * Object-shaped responses are spread onto the top-level payload rather than
 * nested under a `message` key — otherwise every extra field a custom
 * exception attaches (and every built-in exception's own `message`) would
 * end up double-nested at `body.message.<field>` instead of `body.<field>`,
 * which is not a shape any client should have to know to reach into.
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

    if (!isHttpException) {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      )
    }

    const responseBody: string | object = isHttpException
      ? exception.getResponse()
      : 'Internal server error'
    const extraFields = isRecord(responseBody) ? responseBody : {}
    const message: string | string[] =
      typeof extraFields.message === 'string' || isStringArray(extraFields.message)
        ? extraFields.message
        : typeof responseBody === 'string'
          ? responseBody
          : 'Internal server error'

    const payload: ErrorPayload = {
      ...extraFields,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    }

    response.status(status).json(payload)
  }
}

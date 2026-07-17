import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
  type ArgumentsHost,
} from '@nestjs/common'
import { AllExceptionsFilter } from './http-exception.filter'

function makeHost() {
  const json = jest.fn()
  const status = jest.fn().mockReturnValue({ json })
  const response = { status }
  const request = { url: '/entries/1' }
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost
  return { host, status, json }
}

describe('AllExceptionsFilter', () => {
  it('passes through an HttpException status and message', () => {
    const filter = new AllExceptionsFilter()
    const { host, status, json } = makeHost()

    filter.catch(new HttpException('Entry not found', HttpStatus.NOT_FOUND), host)

    expect(status).toHaveBeenCalledWith(404)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        path: '/entries/1',
        message: 'Entry not found',
      }),
    )
  })

  it('maps an unknown thrown error to a generic 500 without leaking its message', () => {
    const filter = new AllExceptionsFilter()
    const { host, status, json } = makeHost()

    filter.catch(new Error('database password is hunter2'), host)

    expect(status).toHaveBeenCalledWith(500)
    const payload = json.mock.calls[0][0] as { message: string }
    expect(payload.message).toBe('Internal server error')
    expect(payload.message).not.toContain('hunter2')
  })

  it('maps a non-Error thrown value to a generic 500 as well', () => {
    const filter = new AllExceptionsFilter()
    const { host, status, json } = makeHost()

    filter.catch('a string thrown for some reason', host)

    expect(status).toHaveBeenCalledWith(500)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, message: 'Internal server error' }),
    )
  })

  it('promotes extra fields from an object-shaped getResponse() to the top level instead of nesting them under message', () => {
    // Mirrors EntryVersionConflictException: an HttpException constructed
    // with an object payload `{ message, currentEntry }`. A client must be
    // able to read `currentEntry` directly off the response body, not at
    // `body.message.currentEntry` — any custom exception that piggybacks
    // extra data on its response body relies on this.
    const filter = new AllExceptionsFilter()
    const { host, status, json } = makeHost()

    filter.catch(
      new HttpException(
        { message: 'Entry has been modified since the version this update was based on', currentEntry: { id: 1, version: 2 } },
        HttpStatus.CONFLICT,
      ),
      host,
    )

    expect(status).toHaveBeenCalledWith(409)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        path: '/entries/1',
        message: 'Entry has been modified since the version this update was based on',
        currentEntry: { id: 1, version: 2 },
      }),
    )
  })

  it('still resolves the standard NestJS { statusCode, message, error } object shape to a plain string message', () => {
    // e.g. new NotFoundException('Entry 1 not found') — Nest builds this
    // shape automatically; the filter must not leave `message` as that
    // nested object.
    const filter = new AllExceptionsFilter()
    const { host, status, json } = makeHost()

    filter.catch(new NotFoundException('Entry 1 not found'), host)

    expect(status).toHaveBeenCalledWith(404)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404, message: 'Entry 1 not found' }),
    )
    const payload = json.mock.calls[json.mock.calls.length - 1][0] as { message: unknown }
    expect(typeof payload.message).toBe('string')
  })

  it('preserves a ValidationPipe-style message array rather than collapsing it to a generic message', () => {
    // The global ValidationPipe (main.ts) throws a BadRequestException whose
    // getResponse() is `{ statusCode, message: string[], error }` — an
    // array of per-field validation errors, not a single string. Flattening
    // object-shaped responses to the top level must not treat "message
    // isn't a string" as "discard it": clients rely on this array to know
    // which fields failed and why.
    const filter = new AllExceptionsFilter()
    const { host, status, json } = makeHost()

    filter.catch(
      new BadRequestException(['shape must be one of the following values: circle, square']),
      host,
    )

    expect(status).toHaveBeenCalledWith(400)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: ['shape must be one of the following values: circle, square'],
      }),
    )
  })
})

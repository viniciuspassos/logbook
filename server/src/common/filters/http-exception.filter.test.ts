import { HttpException, HttpStatus, type ArgumentsHost } from '@nestjs/common'
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
})

import { syncRequest, syncRequestBlob } from './httpClient.ts'
import { SyncAuthError, SyncConflictError, SyncHttpError, SyncNetworkError } from './errors.ts'
import type { ServerEntry } from '../../types/sync.ts'

type FetchMock = jest.MockedFunction<typeof fetch>

/** Minimal fake `Response` — jsdom has no real `Response` global (see probe
 *  in httpClient.ts's doc comment), and this test only needs the subset of
 *  the interface httpClient.ts actually reads. */
function fakeResponse(init: {
  status: number
  json?: unknown
  text?: string
  blob?: Blob
}): Response {
  const body = init.text ?? (init.json !== undefined ? JSON.stringify(init.json) : '')
  return {
    status: init.status,
    ok: init.status >= 200 && init.status < 300,
    text: () => Promise.resolve(body),
    blob: () => Promise.resolve(init.blob ?? new Blob([body])),
  } as unknown as Response
}

function installFetch(): FetchMock {
  const mock = jest.fn() as FetchMock
  globalThis.fetch = mock
  return mock
}

afterEach(() => {
  delete (globalThis as { fetch?: typeof fetch }).fetch
  for (const part of document.cookie.split(';')) {
    const key = part.split('=')[0]?.trim()
    if (key) document.cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`
  }
})

describe('syncRequest', () => {
  it('throws SyncNetworkError when fetch is unavailable', async () => {
    await expect(syncRequest('/entries')).rejects.toBeInstanceOf(SyncNetworkError)
  })

  it('GETs against the configured base URL with credentials included', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, json: [{ id: 1 }] }))

    const result = await syncRequest<{ id: number }[]>('/entries')

    expect(result).toEqual([{ id: 1 }])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/entries')
    expect(init?.credentials).toBe('include')
    expect(init?.method).toBe('GET')
  })

  it('JSON-encodes a plain object body and sets Content-Type', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(fakeResponse({ status: 201, json: { id: 1 } }))

    await syncRequest('/entries', { method: 'POST', body: { title: 'Peak' } })

    const [, init] = fetchMock.mock.calls[0]
    expect(init?.body).toBe(JSON.stringify({ title: 'Peak' }))
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('sends a FormData body as-is, without a Content-Type header', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(fakeResponse({ status: 201, json: {} }))
    const form = new FormData()

    await syncRequest('/entries/1/attachments', { method: 'POST', body: form })

    const [, init] = fetchMock.mock.calls[0]
    expect(init?.body).toBe(form)
    expect((init?.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('attaches the CSRF header from the cookie on mutating requests', async () => {
    document.cookie = 'logbook_csrf=tok123'
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, json: {} }))

    await syncRequest('/entries/1', { method: 'DELETE' })

    const [, init] = fetchMock.mock.calls[0]
    expect((init?.headers as Record<string, string>)['x-csrf-token']).toBe('tok123')
  })

  it('omits the CSRF header on a GET', async () => {
    document.cookie = 'logbook_csrf=tok123'
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, json: {} }))

    await syncRequest('/entries')

    const [, init] = fetchMock.mock.calls[0]
    expect((init?.headers as Record<string, string>)['x-csrf-token']).toBeUndefined()
  })

  it('returns undefined for a 204 response', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(fakeResponse({ status: 204, text: '' }))

    await expect(syncRequest('/entries/1')).resolves.toBeUndefined()
  })

  it('wraps a fetch rejection in SyncNetworkError', async () => {
    const fetchMock = installFetch()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(syncRequest('/entries')).rejects.toBeInstanceOf(SyncNetworkError)
  })

  it('rethrows an AbortError as-is', async () => {
    const fetchMock = installFetch()
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'))

    await expect(syncRequest('/entries')).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('throws SyncAuthError on 401', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(
      fakeResponse({ status: 401, json: { message: 'Authentication required' } }),
    )

    await expect(syncRequest('/entries')).rejects.toBeInstanceOf(SyncAuthError)
  })

  it('throws SyncAuthError on 403', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(fakeResponse({ status: 403, json: { message: 'CSRF validation failed' } }))

    await expect(syncRequest('/entries/1', { method: 'DELETE' })).rejects.toBeInstanceOf(SyncAuthError)
  })

  it('throws SyncConflictError on 409 with the nested AllExceptionsFilter shape', async () => {
    const currentEntry = { id: 1, version: 4, title: 'Updated elsewhere' } as ServerEntry
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(
      fakeResponse({
        status: 409,
        json: {
          statusCode: 409,
          timestamp: '2026-01-01T00:00:00.000Z',
          path: '/entries/1',
          message: {
            message: 'Entry has been modified since the version this update was based on',
            currentEntry,
          },
        },
      }),
    )

    try {
      await syncRequest('/entries/1', { method: 'PATCH', body: { version: 1 } })
      throw new Error('expected syncRequest to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(SyncConflictError)
      expect((error as SyncConflictError).currentEntry).toEqual(currentEntry)
      expect((error as SyncConflictError).message).toBe(
        'Entry has been modified since the version this update was based on',
      )
    }
  })

  it('throws a generic SyncHttpError for other error statuses', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(fakeResponse({ status: 500, json: { message: 'Internal server error' } }))

    await expect(syncRequest('/entries')).rejects.toMatchObject({
      status: 500,
      message: 'Internal server error',
    })
  })

  it('falls back to a generic message when the error body has none', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(fakeResponse({ status: 500, text: '' }))

    await expect(syncRequest('/entries')).rejects.toMatchObject({
      message: 'Request failed with status 500.',
    })
  })
})

describe('syncRequestBlob', () => {
  it('returns the response body as a Blob on success', async () => {
    const blob = new Blob(['bytes'], { type: 'image/jpeg' })
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, blob }))

    const result = await syncRequestBlob('/attachments/1/file')
    expect(result).toBe(blob)
  })

  it('throws a typed error on a non-2xx status', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(fakeResponse({ status: 404, json: { message: 'Not found' } }))

    await expect(syncRequestBlob('/attachments/999/file')).rejects.toBeInstanceOf(SyncHttpError)
  })
})

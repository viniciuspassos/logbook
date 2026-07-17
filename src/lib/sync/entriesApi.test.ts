import { createEntry, deleteEntry, getEntry, listEntries, updateEntry } from './entriesApi.ts'
import { SyncConflictError } from './errors.ts'
import type { CreateEntryPayload, ServerEntry } from '../../types/sync.ts'

function installFetch(): jest.MockedFunction<typeof fetch> {
  const mock = jest.fn() as jest.MockedFunction<typeof fetch>
  globalThis.fetch = mock
  return mock
}

function jsonResponse(status: number, json: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(JSON.stringify(json)),
  } as unknown as Response
}

afterEach(() => {
  delete (globalThis as { fetch?: typeof fetch }).fetch
})

const payload: CreateEntryPayload = {
  title: 'Summit day',
  shape: 'triangle',
  location: 'Rainier',
  date: 'Jul 3',
  metric: '4,392m',
  excerpt: 'A climb.',
  weather: 'Clear',
  duration: '2 days',
  difficulty: 'Hard',
  equipment: 'Crampons',
  participants: 'Solo',
  raw: 'raw notes',
  story: 'A story.',
  photoHint: 'summit',
  media: ['a', 'b', 'c'],
  mapX: 50,
  mapY: 50,
}

const serverEntry: ServerEntry = { ...payload, id: 1, version: 1 }

describe('listEntries', () => {
  it('GETs /entries', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(jsonResponse(200, [serverEntry]))

    expect(await listEntries()).toEqual([serverEntry])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/entries')
  })
})

describe('getEntry', () => {
  it('GETs /entries/:id', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(jsonResponse(200, serverEntry))

    expect(await getEntry(1)).toEqual(serverEntry)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/entries/1')
  })
})

describe('createEntry', () => {
  it('POSTs the payload to /entries', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(jsonResponse(201, serverEntry))

    const result = await createEntry(payload)

    expect(result).toEqual(serverEntry)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/entries')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify(payload))
  })
})

describe('updateEntry', () => {
  it('PATCHes /entries/:id with the version', async () => {
    const fetchMock = installFetch()
    const updated = { ...serverEntry, version: 2, title: 'Updated' }
    fetchMock.mockResolvedValue(jsonResponse(200, updated))

    const result = await updateEntry(1, { title: 'Updated', version: 1 })

    expect(result).toEqual(updated)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/entries/1')
    expect(init?.method).toBe('PATCH')
    expect(init?.body).toBe(JSON.stringify({ title: 'Updated', version: 1 }))
  })

  it('rejects with SyncConflictError on a version mismatch (409)', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        message: {
          message: 'Entry has been modified since the version this update was based on',
          currentEntry: { ...serverEntry, version: 5 },
        },
      }),
    )

    await expect(updateEntry(1, { title: 'Updated', version: 1 })).rejects.toBeInstanceOf(
      SyncConflictError,
    )
  })
})

describe('deleteEntry', () => {
  it('DELETEs /entries/:id and resolves on 204', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue({ status: 204, ok: true, text: () => Promise.resolve('') } as unknown as Response)

    await expect(deleteEntry(1)).resolves.toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/entries/1')
    expect(init?.method).toBe('DELETE')
  })
})

import {
  attachmentFileUrl,
  deleteAttachment,
  getAttachmentFile,
  getAttachmentMetadata,
  listAttachmentsForEntry,
  uploadAttachment,
} from './attachmentsApi.ts'
import type { ServerAttachment } from '../../types/sync.ts'

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

const attachment: ServerAttachment = {
  id: 1,
  entryId: 7,
  originalFilename: 'summit.jpg',
  storageKey: 'key-1',
  mimeType: 'image/jpeg',
  sizeBytes: 12345,
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('uploadAttachment', () => {
  it('POSTs a multipart form with the file under the "file" field', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(jsonResponse(201, attachment))
    const blob = new Blob(['bytes'], { type: 'image/jpeg' })

    const result = await uploadAttachment(7, blob, 'summit.jpg')

    expect(result).toEqual(attachment)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/entries/7/attachments')
    expect(init?.method).toBe('POST')
    const form = init?.body as FormData
    expect(form).toBeInstanceOf(FormData)
    const uploaded = form.get('file')
    expect(uploaded).not.toBeNull()
  })

  it('rejects with a typed error on a 413 (too large)', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(jsonResponse(413, { message: 'File too large' }))

    await expect(uploadAttachment(7, new Blob(['x']), 'x.jpg')).rejects.toMatchObject({ status: 413 })
  })

  it('rejects with a typed error on a 400 (not a real image)', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(jsonResponse(400, { message: 'Not a supported image type' }))

    await expect(uploadAttachment(7, new Blob(['x']), 'x.txt')).rejects.toMatchObject({ status: 400 })
  })
})

describe('listAttachmentsForEntry', () => {
  it('GETs /entries/:entryId/attachments', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(jsonResponse(200, [attachment]))

    expect(await listAttachmentsForEntry(7)).toEqual([attachment])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/entries/7/attachments')
  })
})

describe('getAttachmentMetadata', () => {
  it('GETs /attachments/:id', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue(jsonResponse(200, attachment))

    expect(await getAttachmentMetadata(1)).toEqual(attachment)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/attachments/1')
  })
})

describe('getAttachmentFile', () => {
  it('GETs /attachments/:id/file and returns a Blob', async () => {
    const blob = new Blob(['bytes'], { type: 'image/jpeg' })
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      blob: () => Promise.resolve(blob),
    } as unknown as Response)

    const result = await getAttachmentFile(1)

    expect(result).toBe(blob)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/attachments/1/file')
  })
})

describe('attachmentFileUrl', () => {
  it('builds a same-origin URL an <img src> can use directly (cookies ride along)', () => {
    expect(attachmentFileUrl(1)).toBe('/api/attachments/1/file')
  })
})

describe('deleteAttachment', () => {
  it('DELETEs /attachments/:id', async () => {
    const fetchMock = installFetch()
    fetchMock.mockResolvedValue({ status: 204, ok: true, text: () => Promise.resolve('') } as unknown as Response)

    await expect(deleteAttachment(1)).resolves.toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/attachments/1')
    expect(init?.method).toBe('DELETE')
  })
})

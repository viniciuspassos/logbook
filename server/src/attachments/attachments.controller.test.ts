import type { Response } from 'express'
import { AttachmentsController } from './attachments.controller'
import type { AttachmentsService } from './attachments.service'
import type { Attachment } from './attachment.entity'

function fakeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 1,
    entryId: 10,
    originalFilename: 'summit.jpg',
    storageKey: 'uuid-summit.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1234,
    createdAt: new Date(),
    ...overrides,
  }
}

function makeServiceMock() {
  return {
    getMetadata: jest.fn(),
    getFile: jest.fn(),
    remove: jest.fn(),
  } as unknown as jest.Mocked<AttachmentsService>
}

function makeResMock() {
  const setHeader = jest.fn()
  const send = jest.fn()
  return { setHeader, send } as unknown as jest.Mocked<Response>
}

describe('AttachmentsController', () => {
  it('metadata delegates to the service', async () => {
    const service = makeServiceMock()
    const row = fakeAttachment()
    service.getMetadata.mockResolvedValue(row)
    const controller = new AttachmentsController(service)

    await expect(controller.metadata(1)).resolves.toBe(row)
    expect(service.getMetadata).toHaveBeenCalledWith(1)
  })

  it('file streams the bytes using the contentType/disposition the service derived from the actual bytes', async () => {
    const service = makeServiceMock()
    const attachment = fakeAttachment()
    const buffer = Buffer.from('bytes')
    service.getFile.mockResolvedValue({
      attachment,
      buffer,
      contentType: 'image/jpeg',
      disposition: 'inline',
    })
    const controller = new AttachmentsController(service)
    const res = makeResMock()

    await controller.file(1, res)

    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff')
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg')
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('inline;'),
    )
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining(attachment.originalFilename),
    )
    expect(res.send).toHaveBeenCalledWith(buffer)
  })

  it('file forces attachment/octet-stream headers when the service reports a non-image, non-renderable file', async () => {
    const service = makeServiceMock()
    const attachment = fakeAttachment({ mimeType: 'text/html' })
    const buffer = Buffer.from('<script>alert(1)</script>')
    service.getFile.mockResolvedValue({
      attachment,
      buffer,
      contentType: 'application/octet-stream',
      disposition: 'attachment',
    })
    const controller = new AttachmentsController(service)
    const res = makeResMock()

    await controller.file(1, res)

    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff')
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/octet-stream')
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('attachment;'),
    )
  })

  it('file sets a header-injection-safe Content-Disposition for a filename containing a quote and CRLF', async () => {
    const service = makeServiceMock()
    const attachment = fakeAttachment({
      originalFilename: 'evil".jpg\r\nSet-Cookie: pwned=1',
    })
    const buffer = Buffer.from('bytes')
    service.getFile.mockResolvedValue({
      attachment,
      buffer,
      contentType: 'image/jpeg',
      disposition: 'inline',
    })
    const controller = new AttachmentsController(service)
    const res = makeResMock()

    await controller.file(1, res)

    const dispositionCall = res.setHeader.mock.calls.find(
      ([headerName]) => headerName === 'Content-Disposition',
    )
    expect(dispositionCall).toBeDefined()
    const [, dispositionValue] = dispositionCall as [string, string]
    expect(dispositionValue).not.toMatch(/[\r\n]/)
  })

  it('remove delegates to the service', async () => {
    const service = makeServiceMock()
    service.remove.mockResolvedValue(undefined)
    const controller = new AttachmentsController(service)

    await controller.remove(1)

    expect(service.remove).toHaveBeenCalledWith(1)
  })
})

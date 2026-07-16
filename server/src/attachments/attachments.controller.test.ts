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

  it('file streams the bytes with the right content headers', async () => {
    const service = makeServiceMock()
    const attachment = fakeAttachment()
    const buffer = Buffer.from('bytes')
    service.getFile.mockResolvedValue({ attachment, buffer })
    const controller = new AttachmentsController(service)
    const res = makeResMock()

    await controller.file(1, res)

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', attachment.mimeType)
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining(attachment.originalFilename),
    )
    expect(res.send).toHaveBeenCalledWith(buffer)
  })

  it('remove delegates to the service', async () => {
    const service = makeServiceMock()
    service.remove.mockResolvedValue(undefined)
    const controller = new AttachmentsController(service)

    await controller.remove(1)

    expect(service.remove).toHaveBeenCalledWith(1)
  })
})

import { BadRequestException } from '@nestjs/common'
import { EntryAttachmentsController } from './entry-attachments.controller'
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

function fakeMulterFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'summit.jpg',
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: 5,
    buffer: Buffer.from('bytes'),
    destination: '',
    filename: '',
    path: '',
    stream: undefined as unknown as Express.Multer.File['stream'],
    ...overrides,
  }
}

function makeServiceMock() {
  return {
    uploadForEntry: jest.fn(),
    listForEntry: jest.fn(),
  } as unknown as jest.Mocked<AttachmentsService>
}

describe('EntryAttachmentsController', () => {
  it('upload delegates to the service with entryId and the file bytes', async () => {
    const service = makeServiceMock()
    const created = fakeAttachment()
    service.uploadForEntry.mockResolvedValue(created)
    const controller = new EntryAttachmentsController(service)
    const file = fakeMulterFile()

    const result = await controller.upload(10, file)

    // Deep-equal, so this also proves the client-declared file.mimetype is
    // never forwarded to the service (#19) — an extra `mimeType` property
    // on the call argument would fail this assertion.
    expect(service.uploadForEntry).toHaveBeenCalledWith(10, {
      buffer: file.buffer,
      originalFilename: file.originalname,
    })
    expect(result).toBe(created)
  })

  it('upload delegates the same way even when the client sends a spoofed mimetype (#19)', async () => {
    const service = makeServiceMock()
    const created = fakeAttachment()
    service.uploadForEntry.mockResolvedValue(created)
    const controller = new EntryAttachmentsController(service)
    const file = fakeMulterFile({ mimetype: 'text/html' })

    await controller.upload(10, file)

    expect(service.uploadForEntry).toHaveBeenCalledWith(10, {
      buffer: file.buffer,
      originalFilename: file.originalname,
    })
  })

  it('upload rejects with BadRequestException when no file is present', async () => {
    const service = makeServiceMock()
    const controller = new EntryAttachmentsController(service)

    await expect(controller.upload(10, undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(service.uploadForEntry).not.toHaveBeenCalled()
  })

  it('list delegates to the service with entryId', async () => {
    const service = makeServiceMock()
    const rows = [fakeAttachment()]
    service.listForEntry.mockResolvedValue(rows)
    const controller = new EntryAttachmentsController(service)

    await expect(controller.list(10)).resolves.toBe(rows)
    expect(service.listForEntry).toHaveBeenCalledWith(10)
  })
})

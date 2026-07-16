import { NotFoundException } from '@nestjs/common'
import { AttachmentsService } from './attachments.service'
import type { AttachmentsRepository } from './attachments.repository'
import type { EntriesRepository } from '../entries/entries.repository'
import type { FileStorage } from '../storage/storage.interface'
import { StorageFileNotFoundError } from '../storage/storage.interface'
import type { Attachment } from './attachment.entity'
import type { Entry } from '../entries/entry.entity'

function fakeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 10,
    title: 't',
    shape: 'circle',
    location: 'l',
    date: 'd',
    metric: 'm',
    excerpt: 'e',
    weather: 'w',
    duration: 'du',
    difficulty: 'di',
    equipment: 'eq',
    participants: 'p',
    raw: 'r',
    story: 's',
    photoHint: 'ph',
    media: ['a', 'b', 'c'],
    mapX: 1,
    mapY: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

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

function makeMocks() {
  const attachmentsRepository = {
    findByEntryId: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    remove: jest.fn(),
  } as unknown as jest.Mocked<AttachmentsRepository>

  const entriesRepository = {
    findById: jest.fn(),
  } as unknown as jest.Mocked<EntriesRepository>

  const fileStorage = {
    save: jest.fn(),
    read: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<FileStorage>

  return { attachmentsRepository, entriesRepository, fileStorage }
}

describe('AttachmentsService', () => {
  it('uploadForEntry saves the file then creates an attachment row when the entry exists', async () => {
    const { attachmentsRepository, entriesRepository, fileStorage } = makeMocks()
    entriesRepository.findById.mockResolvedValue(fakeEntry())
    fileStorage.save.mockResolvedValue({ key: 'uuid-summit.jpg', sizeBytes: 1234 })
    const created = fakeAttachment()
    attachmentsRepository.create.mockResolvedValue(created)
    const service = new AttachmentsService(attachmentsRepository, entriesRepository, fileStorage)

    const result = await service.uploadForEntry(10, {
      buffer: Buffer.from('bytes'),
      originalFilename: 'summit.jpg',
      mimeType: 'image/jpeg',
    })

    expect(fileStorage.save).toHaveBeenCalledWith({
      buffer: Buffer.from('bytes'),
      originalFilename: 'summit.jpg',
      mimeType: 'image/jpeg',
    })
    expect(attachmentsRepository.create).toHaveBeenCalledWith({
      entryId: 10,
      originalFilename: 'summit.jpg',
      storageKey: 'uuid-summit.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1234,
    })
    expect(result).toBe(created)
  })

  it('uploadForEntry throws NotFoundException without touching storage when the entry does not exist', async () => {
    const { attachmentsRepository, entriesRepository, fileStorage } = makeMocks()
    entriesRepository.findById.mockResolvedValue(null)
    const service = new AttachmentsService(attachmentsRepository, entriesRepository, fileStorage)

    await expect(
      service.uploadForEntry(999, {
        buffer: Buffer.from('x'),
        originalFilename: 'x.jpg',
        mimeType: 'image/jpeg',
      }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(fileStorage.save).not.toHaveBeenCalled()
  })

  it('listForEntry returns attachments when the entry exists', async () => {
    const { attachmentsRepository, entriesRepository, fileStorage } = makeMocks()
    entriesRepository.findById.mockResolvedValue(fakeEntry())
    const rows = [fakeAttachment()]
    attachmentsRepository.findByEntryId.mockResolvedValue(rows)
    const service = new AttachmentsService(attachmentsRepository, entriesRepository, fileStorage)

    await expect(service.listForEntry(10)).resolves.toBe(rows)
  })

  it('listForEntry throws NotFoundException when the entry does not exist', async () => {
    const { attachmentsRepository, entriesRepository, fileStorage } = makeMocks()
    entriesRepository.findById.mockResolvedValue(null)
    const service = new AttachmentsService(attachmentsRepository, entriesRepository, fileStorage)

    await expect(service.listForEntry(999)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('getMetadata returns the attachment when found', async () => {
    const { attachmentsRepository, entriesRepository, fileStorage } = makeMocks()
    const row = fakeAttachment()
    attachmentsRepository.findById.mockResolvedValue(row)
    const service = new AttachmentsService(attachmentsRepository, entriesRepository, fileStorage)

    await expect(service.getMetadata(1)).resolves.toBe(row)
  })

  it('getMetadata throws NotFoundException when missing', async () => {
    const { attachmentsRepository, entriesRepository, fileStorage } = makeMocks()
    attachmentsRepository.findById.mockResolvedValue(null)
    const service = new AttachmentsService(attachmentsRepository, entriesRepository, fileStorage)

    await expect(service.getMetadata(999)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('getFile returns metadata plus the file bytes', async () => {
    const { attachmentsRepository, entriesRepository, fileStorage } = makeMocks()
    const row = fakeAttachment()
    attachmentsRepository.findById.mockResolvedValue(row)
    fileStorage.read.mockResolvedValue(Buffer.from('bytes'))
    const service = new AttachmentsService(attachmentsRepository, entriesRepository, fileStorage)

    const result = await service.getFile(1)

    expect(fileStorage.read).toHaveBeenCalledWith(row.storageKey)
    expect(result).toEqual({ attachment: row, buffer: Buffer.from('bytes') })
  })

  it('getFile throws NotFoundException when the metadata row is missing', async () => {
    const { attachmentsRepository, entriesRepository, fileStorage } = makeMocks()
    attachmentsRepository.findById.mockResolvedValue(null)
    const service = new AttachmentsService(attachmentsRepository, entriesRepository, fileStorage)

    await expect(service.getFile(999)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('getFile throws NotFoundException when the row exists but the stored bytes are missing', async () => {
    const { attachmentsRepository, entriesRepository, fileStorage } = makeMocks()
    attachmentsRepository.findById.mockResolvedValue(fakeAttachment())
    fileStorage.read.mockRejectedValue(new StorageFileNotFoundError('uuid-summit.jpg'))
    const service = new AttachmentsService(attachmentsRepository, entriesRepository, fileStorage)

    await expect(service.getFile(1)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('remove deletes the stored file then the metadata row', async () => {
    const { attachmentsRepository, entriesRepository, fileStorage } = makeMocks()
    const row = fakeAttachment()
    attachmentsRepository.findById.mockResolvedValue(row)
    attachmentsRepository.remove.mockResolvedValue(true)
    const service = new AttachmentsService(attachmentsRepository, entriesRepository, fileStorage)

    await service.remove(1)

    expect(fileStorage.delete).toHaveBeenCalledWith(row.storageKey)
    expect(attachmentsRepository.remove).toHaveBeenCalledWith(1)
  })

  it('remove throws NotFoundException when the attachment does not exist', async () => {
    const { attachmentsRepository, entriesRepository, fileStorage } = makeMocks()
    attachmentsRepository.findById.mockResolvedValue(null)
    const service = new AttachmentsService(attachmentsRepository, entriesRepository, fileStorage)

    await expect(service.remove(999)).rejects.toBeInstanceOf(NotFoundException)
    expect(fileStorage.delete).not.toHaveBeenCalled()
  })
})

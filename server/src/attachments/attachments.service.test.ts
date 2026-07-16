import { Logger, NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common'
import { AttachmentsService } from './attachments.service'
import type { AttachmentsRepository } from './attachments.repository'
import type { EntriesRepository } from '../entries/entries.repository'
import type { FileStorage } from '../storage/storage.interface'
import { StorageFileNotFoundError } from '../storage/storage.interface'
import type { Attachment } from './attachment.entity'
import type { Entry } from '../entries/entry.entity'

// Real magic bytes for a JPEG (SOI + JFIF marker) — detectImageType() must
// see genuine signature bytes to classify a file as image/jpeg, so tests
// that exercise the "accepted" path use this instead of arbitrary bytes.
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

// An HTML payload declaring itself (via a spoofed client Content-Type, which
// this service must never trust) as an image — the stored-XSS case from #19.
const HTML_PAYLOAD_BYTES = Buffer.from(
  '<html><body><script>alert(document.cookie)</script></body></html>',
  'utf-8',
)

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
  it('uploadForEntry detects the type from the file bytes (not a client-declared mimeType) and saves it', async () => {
    const { attachmentsRepository, entriesRepository, fileStorage } = makeMocks()
    entriesRepository.findById.mockResolvedValue(fakeEntry())
    fileStorage.save.mockResolvedValue({ key: 'uuid-summit.jpg', sizeBytes: JPEG_BYTES.byteLength })
    const created = fakeAttachment({ sizeBytes: JPEG_BYTES.byteLength })
    attachmentsRepository.create.mockResolvedValue(created)
    const service = new AttachmentsService(attachmentsRepository, entriesRepository, fileStorage)

    const result = await service.uploadForEntry(10, {
      buffer: JPEG_BYTES,
      originalFilename: 'summit.jpg',
    })

    expect(fileStorage.save).toHaveBeenCalledWith({
      buffer: JPEG_BYTES,
      originalFilename: 'summit.jpg',
      mimeType: 'image/jpeg',
    })
    expect(attachmentsRepository.create).toHaveBeenCalledWith({
      entryId: 10,
      originalFilename: 'summit.jpg',
      storageKey: 'uuid-summit.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: JPEG_BYTES.byteLength,
    })
    expect(result).toBe(created)
  })

  it('uploadForEntry throws NotFoundException without touching storage when the entry does not exist', async () => {
    const { attachmentsRepository, entriesRepository, fileStorage } = makeMocks()
    entriesRepository.findById.mockResolvedValue(null)
    const service = new AttachmentsService(attachmentsRepository, entriesRepository, fileStorage)

    await expect(
      service.uploadForEntry(999, {
        buffer: JPEG_BYTES,
        originalFilename: 'x.jpg',
      }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(fileStorage.save).not.toHaveBeenCalled()
  })

  it('uploadForEntry rejects an HTML payload spoofed as an image with UnsupportedMediaTypeException and never touches storage (#19)', async () => {
    const { attachmentsRepository, entriesRepository, fileStorage } = makeMocks()
    entriesRepository.findById.mockResolvedValue(fakeEntry())
    const service = new AttachmentsService(attachmentsRepository, entriesRepository, fileStorage)

    await expect(
      service.uploadForEntry(10, {
        buffer: HTML_PAYLOAD_BYTES,
        originalFilename: 'summit.png',
      }),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException)
    expect(fileStorage.save).not.toHaveBeenCalled()
    expect(attachmentsRepository.create).not.toHaveBeenCalled()
  })

  it('uploadForEntry rejects a file with unrecognized bytes regardless of its extension', async () => {
    const { attachmentsRepository, entriesRepository, fileStorage } = makeMocks()
    entriesRepository.findById.mockResolvedValue(fakeEntry())
    const service = new AttachmentsService(attachmentsRepository, entriesRepository, fileStorage)

    await expect(
      service.uploadForEntry(10, {
        buffer: Buffer.from('not an image at all'),
        originalFilename: 'totally-legit.jpeg',
      }),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException)
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

  it('getFile returns metadata plus the file bytes, with contentType/disposition derived from the actual bytes (not the stored mimeType)', async () => {
    const { attachmentsRepository, entriesRepository, fileStorage } = makeMocks()
    const row = fakeAttachment()
    attachmentsRepository.findById.mockResolvedValue(row)
    fileStorage.read.mockResolvedValue(JPEG_BYTES)
    const service = new AttachmentsService(attachmentsRepository, entriesRepository, fileStorage)

    const result = await service.getFile(1)

    expect(fileStorage.read).toHaveBeenCalledWith(row.storageKey)
    expect(result).toEqual({
      attachment: row,
      buffer: JPEG_BYTES,
      contentType: 'image/jpeg',
      disposition: 'inline',
    })
  })

  it('getFile forces an octet-stream/attachment download for stored bytes that no longer match an allowlisted image signature (legacy/pre-#19 rows)', async () => {
    const { attachmentsRepository, entriesRepository, fileStorage } = makeMocks()
    // Simulates a row created before the #19 fix, whose DB mimeType column
    // may hold an arbitrary client-declared value (e.g. "text/html") that
    // must never be trusted for the served Content-Type.
    const row = fakeAttachment({ mimeType: 'text/html' })
    attachmentsRepository.findById.mockResolvedValue(row)
    fileStorage.read.mockResolvedValue(HTML_PAYLOAD_BYTES)
    const service = new AttachmentsService(attachmentsRepository, entriesRepository, fileStorage)

    const result = await service.getFile(1)

    expect(result.contentType).toBe('application/octet-stream')
    expect(result.disposition).toBe('attachment')
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

  // Behavior change (#35): this used to delete the stored file *before* the
  // metadata row. The ordering is now inverted to match the entry-cascade
  // path (EntriesService.remove) and #20's rows-first, files-best-effort
  // decision. The assertions below are updated rather than removed — the
  // "removes both the row and the file" contract is unchanged, only the
  // order and the file-failure handling.
  it('remove deletes the metadata row before the stored file (rows-first)', async () => {
    const { attachmentsRepository, entriesRepository, fileStorage } = makeMocks()
    const row = fakeAttachment()
    attachmentsRepository.findById.mockResolvedValue(row)
    attachmentsRepository.remove.mockResolvedValue(true)
    const calls: string[] = []
    attachmentsRepository.remove.mockImplementation(async () => {
      calls.push('row')
      return true
    })
    fileStorage.delete.mockImplementation(async () => {
      calls.push('file')
    })
    const service = new AttachmentsService(attachmentsRepository, entriesRepository, fileStorage)

    await service.remove(1)

    expect(attachmentsRepository.remove).toHaveBeenCalledWith(1)
    expect(fileStorage.delete).toHaveBeenCalledWith(row.storageKey)
    expect(calls).toEqual(['row', 'file'])
  })

  it('remove still resolves and removes the row when the file delete fails (files best-effort)', async () => {
    const { attachmentsRepository, entriesRepository, fileStorage } = makeMocks()
    const row = fakeAttachment({ id: 7, storageKey: 'key-7' })
    attachmentsRepository.findById.mockResolvedValue(row)
    attachmentsRepository.remove.mockResolvedValue(true)
    fileStorage.delete.mockRejectedValue(new Error('EACCES: permission denied'))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const service = new AttachmentsService(attachmentsRepository, entriesRepository, fileStorage)

    // A disk error must never make an attachment undeletable: the row is
    // gone and the caller sees success, with the stranded file logged.
    await expect(service.remove(7)).resolves.toBeUndefined()

    expect(attachmentsRepository.remove).toHaveBeenCalledWith(7)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('key-7'))
    warnSpy.mockRestore()
  })

  it('remove throws NotFoundException when the attachment does not exist', async () => {
    const { attachmentsRepository, entriesRepository, fileStorage } = makeMocks()
    attachmentsRepository.findById.mockResolvedValue(null)
    const service = new AttachmentsService(attachmentsRepository, entriesRepository, fileStorage)

    await expect(service.remove(999)).rejects.toBeInstanceOf(NotFoundException)
    expect(fileStorage.delete).not.toHaveBeenCalled()
  })
})

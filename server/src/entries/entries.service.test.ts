import { Logger, NotFoundException } from '@nestjs/common'
import { EntriesService } from './entries.service'
import { EntryVersionConflictException } from './entry-version-conflict.exception'
import type { EntriesRepository } from './entries.repository'
import type { Entry } from './entry.entity'
import type { CreateEntryDto } from './dto/create-entry.dto'
import type { UpdateEntryDto } from './dto/update-entry.dto'
import type { Attachment } from '../attachments/attachment.entity'
import type { FileStorage } from '../storage/storage.interface'

function fakeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 1,
    title: 'Solo tandem jump',
    shape: 'circle',
    location: 'Interlaken',
    date: 'Jul 3',
    metric: '4,000m',
    excerpt: 'excerpt',
    weather: 'clear',
    duration: '45s',
    difficulty: 'Advanced',
    equipment: 'rig',
    participants: 'solo',
    raw: 'raw text',
    story: 'story text',
    photoHint: 'hint',
    media: ['a', 'b', 'c'],
    mapX: 10,
    mapY: 20,
    version: 1,
    supersededEdits: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function fakeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 1,
    entryId: 1,
    originalFilename: 'summit.jpg',
    storageKey: 'key-1',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    userId: null,
    createdAt: new Date(),
    ...overrides,
  }
}

function fakeCreateDto(): CreateEntryDto {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = fakeEntry()
  return rest
}

function makeRepoMock() {
  return {
    findAll: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    removeCascade: jest.fn(),
  } as unknown as jest.Mocked<EntriesRepository>
}

function makeFileStorageMock() {
  return {
    save: jest.fn(),
    read: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<FileStorage>
}

describe('EntriesService', () => {
  it('findAll returns every entry from the repository', async () => {
    const repo = makeRepoMock()
    const entries = [fakeEntry()]
    repo.findAll.mockResolvedValue(entries)
    const service = new EntriesService(repo, makeFileStorageMock())

    await expect(service.findAll()).resolves.toBe(entries)
  })

  it('findOne returns the entry when it exists', async () => {
    const repo = makeRepoMock()
    const entry = fakeEntry()
    repo.findById.mockResolvedValue(entry)
    const service = new EntriesService(repo, makeFileStorageMock())

    await expect(service.findOne(1)).resolves.toBe(entry)
  })

  it('findOne throws NotFoundException when the entry does not exist', async () => {
    const repo = makeRepoMock()
    repo.findById.mockResolvedValue(null)
    const service = new EntriesService(repo, makeFileStorageMock())

    await expect(service.findOne(404)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('create delegates to the repository with the DTO fields', async () => {
    const repo = makeRepoMock()
    const dto = fakeCreateDto()
    const created = fakeEntry()
    repo.create.mockResolvedValue(created)
    const service = new EntriesService(repo, makeFileStorageMock())

    const result = await service.create(dto)

    expect(repo.create).toHaveBeenCalledWith(dto)
    expect(result).toBe(created)
  })

  it('update returns the updated entry when the version matches', async () => {
    const repo = makeRepoMock()
    const updated = fakeEntry({ title: 'New title', version: 2 })
    repo.update.mockResolvedValue({ outcome: 'updated', entry: updated })
    const service = new EntriesService(repo, makeFileStorageMock())
    const dto = { version: 1, title: 'New title' } as UpdateEntryDto

    const result = await service.update(1, dto)

    expect(repo.update).toHaveBeenCalledWith(1, dto)
    expect(result).toBe(updated)
  })

  it('update throws NotFoundException when the entry does not exist', async () => {
    const repo = makeRepoMock()
    repo.update.mockResolvedValue({ outcome: 'not-found' })
    const service = new EntriesService(repo, makeFileStorageMock())

    await expect(
      service.update(404, { version: 1 } as UpdateEntryDto),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('update throws EntryVersionConflictException carrying the current entry, and does not swallow the conflict as a generic error, when the version is stale', async () => {
    const repo = makeRepoMock()
    const current = fakeEntry({ id: 1, version: 5, title: 'Server-side title' })
    repo.update.mockResolvedValue({ outcome: 'conflict', current })
    const service = new EntriesService(repo, makeFileStorageMock())

    const dto = { version: 3, title: 'Stale local edit' } as UpdateEntryDto
    await expect(service.update(1, dto)).rejects.toBeInstanceOf(EntryVersionConflictException)

    try {
      await service.update(1, dto)
      fail('expected update to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(EntryVersionConflictException)
      const response = (error as EntryVersionConflictException).getResponse() as {
        currentEntry: Entry
      }
      expect(response.currentEntry).toBe(current)
    }
  })

  it('remove deletes the entry when it has zero attachments', async () => {
    const repo = makeRepoMock()
    const fileStorage = makeFileStorageMock()
    repo.removeCascade.mockResolvedValue([])
    const service = new EntriesService(repo, fileStorage)

    await expect(service.remove(1)).resolves.toBeUndefined()

    expect(repo.removeCascade).toHaveBeenCalledWith(1)
    expect(fileStorage.delete).not.toHaveBeenCalled()
  })

  it('remove throws NotFoundException when the entry does not exist', async () => {
    const repo = makeRepoMock()
    const fileStorage = makeFileStorageMock()
    repo.removeCascade.mockResolvedValue(null)
    const service = new EntriesService(repo, fileStorage)

    await expect(service.remove(404)).rejects.toBeInstanceOf(NotFoundException)
    expect(fileStorage.delete).not.toHaveBeenCalled()
  })

  it('remove cascades: deletes the underlying file for every removed attachment', async () => {
    const repo = makeRepoMock()
    const fileStorage = makeFileStorageMock()
    const attachments = [
      fakeAttachment({ id: 10, storageKey: 'key-10' }),
      fakeAttachment({ id: 11, storageKey: 'key-11' }),
    ]
    repo.removeCascade.mockResolvedValue(attachments)
    fileStorage.delete.mockResolvedValue(undefined)
    const service = new EntriesService(repo, fileStorage)

    await service.remove(1)

    expect(fileStorage.delete).toHaveBeenCalledWith('key-10')
    expect(fileStorage.delete).toHaveBeenCalledWith('key-11')
    expect(fileStorage.delete).toHaveBeenCalledTimes(2)
  })

  it('remove still resolves and removes rows when a file delete fails (rows-first, files best-effort)', async () => {
    const repo = makeRepoMock()
    const fileStorage = makeFileStorageMock()
    const attachments = [
      fakeAttachment({ id: 10, storageKey: 'key-10' }),
      fakeAttachment({ id: 11, storageKey: 'key-11' }),
    ]
    repo.removeCascade.mockResolvedValue(attachments)
    fileStorage.delete.mockImplementation((key: string) =>
      key === 'key-10' ? Promise.reject(new Error('disk unavailable')) : Promise.resolve(),
    )
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const service = new EntriesService(repo, fileStorage)

    await expect(service.remove(1)).resolves.toBeUndefined()

    expect(fileStorage.delete).toHaveBeenCalledWith('key-10')
    expect(fileStorage.delete).toHaveBeenCalledWith('key-11')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('key-10'))
    warnSpy.mockRestore()
  })
})

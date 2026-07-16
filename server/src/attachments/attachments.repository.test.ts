import type { Repository } from 'typeorm'
import { AttachmentsRepository } from './attachments.repository'
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

function makeRepoMock() {
  return {
    find: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<Repository<Attachment>>
}

describe('AttachmentsRepository', () => {
  it('findByEntryId filters by entryId, newest first', async () => {
    const ormRepo = makeRepoMock()
    const rows = [fakeAttachment({ id: 2 }), fakeAttachment({ id: 1 })]
    ormRepo.find.mockResolvedValue(rows)
    const repo = new AttachmentsRepository(ormRepo)

    const result = await repo.findByEntryId(10)

    expect(ormRepo.find).toHaveBeenCalledWith({
      where: { entryId: 10 },
      order: { id: 'DESC' },
    })
    expect(result).toBe(rows)
  })

  it('findById returns the attachment when found', async () => {
    const ormRepo = makeRepoMock()
    const row = fakeAttachment()
    ormRepo.findOneBy.mockResolvedValue(row)
    const repo = new AttachmentsRepository(ormRepo)

    await expect(repo.findById(1)).resolves.toBe(row)
    expect(ormRepo.findOneBy).toHaveBeenCalledWith({ id: 1 })
  })

  it('findById returns null when not found', async () => {
    const ormRepo = makeRepoMock()
    ormRepo.findOneBy.mockResolvedValue(null)
    const repo = new AttachmentsRepository(ormRepo)

    await expect(repo.findById(999)).resolves.toBeNull()
  })

  it('create builds and saves a new attachment row', async () => {
    const ormRepo = makeRepoMock()
    const draft = fakeAttachment({ id: undefined as unknown as number })
    const saved = fakeAttachment({ id: 7 })
    ormRepo.create.mockReturnValue(draft)
    ormRepo.save.mockResolvedValue(saved)
    const repo = new AttachmentsRepository(ormRepo)

    const input = { entryId: 10 } as unknown as Attachment
    const result = await repo.create(input)

    expect(ormRepo.create).toHaveBeenCalledWith(input)
    expect(ormRepo.save).toHaveBeenCalledWith(draft)
    expect(result).toBe(saved)
  })

  it('remove returns true when a row was deleted', async () => {
    const ormRepo = makeRepoMock()
    ormRepo.delete.mockResolvedValue({ affected: 1, raw: {} })
    const repo = new AttachmentsRepository(ormRepo)

    await expect(repo.remove(1)).resolves.toBe(true)
    expect(ormRepo.delete).toHaveBeenCalledWith(1)
  })

  it('remove returns false when nothing was deleted', async () => {
    const ormRepo = makeRepoMock()
    ormRepo.delete.mockResolvedValue({ affected: 0, raw: {} })
    const repo = new AttachmentsRepository(ormRepo)

    await expect(repo.remove(999)).resolves.toBe(false)
  })
})

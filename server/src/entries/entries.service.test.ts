import { NotFoundException } from '@nestjs/common'
import { EntriesService } from './entries.service'
import type { EntriesRepository } from './entries.repository'
import type { Entry } from './entry.entity'
import type { CreateEntryDto } from './dto/create-entry.dto'

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
    createdAt: new Date(),
    updatedAt: new Date(),
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
    remove: jest.fn(),
  } as unknown as jest.Mocked<EntriesRepository>
}

describe('EntriesService', () => {
  it('findAll returns every entry from the repository', async () => {
    const repo = makeRepoMock()
    const entries = [fakeEntry()]
    repo.findAll.mockResolvedValue(entries)
    const service = new EntriesService(repo)

    await expect(service.findAll()).resolves.toBe(entries)
  })

  it('findOne returns the entry when it exists', async () => {
    const repo = makeRepoMock()
    const entry = fakeEntry()
    repo.findById.mockResolvedValue(entry)
    const service = new EntriesService(repo)

    await expect(service.findOne(1)).resolves.toBe(entry)
  })

  it('findOne throws NotFoundException when the entry does not exist', async () => {
    const repo = makeRepoMock()
    repo.findById.mockResolvedValue(null)
    const service = new EntriesService(repo)

    await expect(service.findOne(404)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('create delegates to the repository with the DTO fields', async () => {
    const repo = makeRepoMock()
    const dto = fakeCreateDto()
    const created = fakeEntry()
    repo.create.mockResolvedValue(created)
    const service = new EntriesService(repo)

    const result = await service.create(dto)

    expect(repo.create).toHaveBeenCalledWith(dto)
    expect(result).toBe(created)
  })

  it('update returns the updated entry when it exists', async () => {
    const repo = makeRepoMock()
    const updated = fakeEntry({ title: 'New title' })
    repo.update.mockResolvedValue(updated)
    const service = new EntriesService(repo)

    const result = await service.update(1, { title: 'New title' })

    expect(repo.update).toHaveBeenCalledWith(1, { title: 'New title' })
    expect(result).toBe(updated)
  })

  it('update throws NotFoundException when the entry does not exist', async () => {
    const repo = makeRepoMock()
    repo.update.mockResolvedValue(null)
    const service = new EntriesService(repo)

    await expect(service.update(404, { title: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('remove resolves when the entry was deleted', async () => {
    const repo = makeRepoMock()
    repo.remove.mockResolvedValue(true)
    const service = new EntriesService(repo)

    await expect(service.remove(1)).resolves.toBeUndefined()
  })

  it('remove throws NotFoundException when the entry does not exist', async () => {
    const repo = makeRepoMock()
    repo.remove.mockResolvedValue(false)
    const service = new EntriesService(repo)

    await expect(service.remove(404)).rejects.toBeInstanceOf(NotFoundException)
  })
})

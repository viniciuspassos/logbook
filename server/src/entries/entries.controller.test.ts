import { EntriesController } from './entries.controller'
import type { EntriesService } from './entries.service'
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

function makeServiceMock() {
  return {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  } as unknown as jest.Mocked<EntriesService>
}

describe('EntriesController', () => {
  it('findAll delegates to the service', async () => {
    const service = makeServiceMock()
    const entries = [fakeEntry()]
    service.findAll.mockResolvedValue(entries)
    const controller = new EntriesController(service)

    await expect(controller.findAll()).resolves.toBe(entries)
  })

  it('findOne delegates to the service with a numeric id', async () => {
    const service = makeServiceMock()
    const entry = fakeEntry()
    service.findOne.mockResolvedValue(entry)
    const controller = new EntriesController(service)

    const result = await controller.findOne(1)

    expect(service.findOne).toHaveBeenCalledWith(1)
    expect(result).toBe(entry)
  })

  it('create delegates to the service with the validated DTO', async () => {
    const service = makeServiceMock()
    const dto = { title: 'x' } as unknown as CreateEntryDto
    const created = fakeEntry()
    service.create.mockResolvedValue(created)
    const controller = new EntriesController(service)

    const result = await controller.create(dto)

    expect(service.create).toHaveBeenCalledWith(dto)
    expect(result).toBe(created)
  })

  it('update delegates to the service with id and DTO', async () => {
    const service = makeServiceMock()
    const updated = fakeEntry({ title: 'New title' })
    service.update.mockResolvedValue(updated)
    const controller = new EntriesController(service)

    const result = await controller.update(1, { title: 'New title' })

    expect(service.update).toHaveBeenCalledWith(1, { title: 'New title' })
    expect(result).toBe(updated)
  })

  it('remove delegates to the service with a numeric id', async () => {
    const service = makeServiceMock()
    service.remove.mockResolvedValue(undefined)
    const controller = new EntriesController(service)

    await controller.remove(1)

    expect(service.remove).toHaveBeenCalledWith(1)
  })
})

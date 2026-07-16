import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { UpdateEntryDto } from './update-entry.dto'

describe('UpdateEntryDto', () => {
  it('accepts an empty payload (no-op patch)', async () => {
    const dto = plainToInstance(UpdateEntryDto, {})
    const errors = await validate(dto)
    expect(errors).toHaveLength(0)
  })

  it('accepts a single-field partial update', async () => {
    const dto = plainToInstance(UpdateEntryDto, { title: 'Updated title' })
    const errors = await validate(dto)
    expect(errors).toHaveLength(0)
  })

  it('still validates the type of a provided field', async () => {
    const dto = plainToInstance(UpdateEntryDto, { mapX: 'not a number' })
    const errors = await validate(dto)
    expect(errors.some((e) => e.property === 'mapX')).toBe(true)
  })

  it('still validates media length when media is provided', async () => {
    const dto = plainToInstance(UpdateEntryDto, { media: ['a', 'b'] })
    const errors = await validate(dto)
    expect(errors.some((e) => e.property === 'media')).toBe(true)
  })

  it('rejects an invalid shape when shape is provided', async () => {
    const dto = plainToInstance(UpdateEntryDto, { shape: 'hexagon' })
    const errors = await validate(dto)
    expect(errors.some((e) => e.property === 'shape')).toBe(true)
  })
})

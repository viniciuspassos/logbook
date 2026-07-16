import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { UpdateEntryDto } from './update-entry.dto'

describe('UpdateEntryDto', () => {
  // Behavior change (#24): `version` is now a required field on every PATCH
  // (the optimistic-concurrency base version this edit was made against), so
  // a payload with no fields to change is no longer valid on its own — it
  // must still carry the version it was read at. The old "empty payload is a
  // no-op patch" test is replaced by the two below rather than deleted: the
  // "no fields to change" case still passes as long as `version` is present,
  // and a payload missing `version` entirely now correctly fails.
  it('accepts a payload with only version (no fields to change)', async () => {
    const dto = plainToInstance(UpdateEntryDto, { version: 3 })
    const errors = await validate(dto)
    expect(errors).toHaveLength(0)
  })

  it('rejects a payload missing version', async () => {
    const dto = plainToInstance(UpdateEntryDto, { title: 'Updated title' })
    const errors = await validate(dto)
    expect(errors.some((e) => e.property === 'version')).toBe(true)
  })

  it('rejects a non-positive version', async () => {
    const dto = plainToInstance(UpdateEntryDto, { version: 0 })
    const errors = await validate(dto)
    expect(errors.some((e) => e.property === 'version')).toBe(true)
  })

  it('accepts a single-field partial update alongside version', async () => {
    const dto = plainToInstance(UpdateEntryDto, { version: 1, title: 'Updated title' })
    const errors = await validate(dto)
    expect(errors).toHaveLength(0)
  })

  it('still validates the type of a provided field', async () => {
    const dto = plainToInstance(UpdateEntryDto, { version: 1, mapX: 'not a number' })
    const errors = await validate(dto)
    expect(errors.some((e) => e.property === 'mapX')).toBe(true)
  })

  it('still validates media length when media is provided', async () => {
    const dto = plainToInstance(UpdateEntryDto, { version: 1, media: ['a', 'b'] })
    const errors = await validate(dto)
    expect(errors.some((e) => e.property === 'media')).toBe(true)
  })

  it('rejects an invalid shape when shape is provided', async () => {
    const dto = plainToInstance(UpdateEntryDto, { version: 1, shape: 'hexagon' })
    const errors = await validate(dto)
    expect(errors.some((e) => e.property === 'shape')).toBe(true)
  })

  it('accepts a supersededEdit payload alongside version', async () => {
    const dto = plainToInstance(UpdateEntryDto, {
      version: 5,
      title: 'Winning title',
      supersededEdit: { title: 'My losing local draft' },
    })
    const errors = await validate(dto)
    expect(errors).toHaveLength(0)
  })

  it('still validates fields nested inside supersededEdit', async () => {
    const dto = plainToInstance(UpdateEntryDto, {
      version: 5,
      supersededEdit: { shape: 'hexagon' },
    })
    const errors = await validate(dto)
    expect(errors.some((e) => e.property === 'supersededEdit')).toBe(true)
  })
})

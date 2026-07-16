import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateEntryDto } from './create-entry.dto'

function validPayload(): Record<string, unknown> {
  return {
    title: 'Solo tandem jump',
    shape: 'circle',
    activityType: 'Skydiving',
    location: 'Interlaken, Switzerland',
    date: 'Jul 3',
    metric: '4,000m · 45s freefall',
    excerpt: 'Clear skies over the Alps.',
    weather: 'Clear, light wind',
    duration: '45s freefall',
    difficulty: 'Advanced',
    equipment: 'Tandem rig, GoPro',
    participants: 'Solo w/ instructor',
    raw: 'Did the tandem jump over Interlaken today.',
    story: 'The plane door opened onto nothing but glacier and blue.',
    photoHint: 'freefall shot',
    media: ['canopy view', 'landing selfie', 'plane door'],
    mapX: 53,
    mapY: 30,
  }
}

async function validateDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(CreateEntryDto, payload)
  return validate(dto)
}

describe('CreateEntryDto', () => {
  it('accepts a fully valid payload', async () => {
    const errors = await validateDto(validPayload())
    expect(errors).toHaveLength(0)
  })

  it('accepts a payload without the optional activityType', async () => {
    const payload = validPayload()
    delete payload.activityType
    const errors = await validateDto(payload)
    expect(errors).toHaveLength(0)
  })

  it('rejects a missing required string field', async () => {
    const payload = validPayload()
    delete payload.title
    const errors = await validateDto(payload)
    expect(errors.some((e) => e.property === 'title')).toBe(true)
  })

  it('rejects an invalid shape value', async () => {
    const payload = { ...validPayload(), shape: 'square' }
    const errors = await validateDto(payload)
    expect(errors.some((e) => e.property === 'shape')).toBe(true)
  })

  it('rejects media arrays that are not exactly length 3', async () => {
    const payload = { ...validPayload(), media: ['only one'] }
    const errors = await validateDto(payload)
    expect(errors.some((e) => e.property === 'media')).toBe(true)
  })

  it('rejects non-string entries inside media', async () => {
    const payload = { ...validPayload(), media: ['a', 'b', 42] }
    const errors = await validateDto(payload)
    expect(errors.some((e) => e.property === 'media')).toBe(true)
  })

  it('rejects mapX/mapY outside the 0-100 percent range', async () => {
    const payload = { ...validPayload(), mapX: 150, mapY: -1 }
    const errors = await validateDto(payload)
    expect(errors.some((e) => e.property === 'mapX')).toBe(true)
    expect(errors.some((e) => e.property === 'mapY')).toBe(true)
  })

  it('rejects unknown extra fields when whitelisted validation is used', async () => {
    const payload = { ...validPayload(), id: 999 }
    const dto = plainToInstance(CreateEntryDto, payload, { excludeExtraneousValues: false })
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true })
    expect(errors.some((e) => e.property === 'id')).toBe(true)
  })
})

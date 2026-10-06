import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { GoogleLoginDto } from './google-login.dto'

describe('GoogleLoginDto', () => {
  it('passes validation with a non-empty idToken', async () => {
    const dto = plainToInstance(GoogleLoginDto, { idToken: 'eyJhbGciOi.payload.sig' })

    await expect(validate(dto)).resolves.toHaveLength(0)
  })

  it('fails validation when idToken is missing', async () => {
    const errors = await validate(plainToInstance(GoogleLoginDto, {}))

    expect(errors.some((e) => e.property === 'idToken')).toBe(true)
  })

  it('fails validation when idToken is an empty string', async () => {
    const errors = await validate(plainToInstance(GoogleLoginDto, { idToken: '' }))

    expect(errors.some((e) => e.property === 'idToken')).toBe(true)
  })

  it('fails validation when idToken is not a string', async () => {
    const errors = await validate(plainToInstance(GoogleLoginDto, { idToken: 12345 }))

    expect(errors.some((e) => e.property === 'idToken')).toBe(true)
  })
})

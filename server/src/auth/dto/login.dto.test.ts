import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { LoginDto } from './login.dto'

describe('LoginDto', () => {
  it('passes validation with a non-empty password', async () => {
    const dto = plainToInstance(LoginDto, { password: 'correct horse battery staple' })

    const errors = await validate(dto)

    expect(errors).toHaveLength(0)
  })

  it('fails validation when password is missing', async () => {
    const dto = plainToInstance(LoginDto, {})

    const errors = await validate(dto)

    expect(errors.some((e) => e.property === 'password')).toBe(true)
  })

  it('fails validation when password is an empty string', async () => {
    const dto = plainToInstance(LoginDto, { password: '' })

    const errors = await validate(dto)

    expect(errors.some((e) => e.property === 'password')).toBe(true)
  })

  it('fails validation when password is not a string', async () => {
    const dto = plainToInstance(LoginDto, { password: 12345 })

    const errors = await validate(dto)

    expect(errors.some((e) => e.property === 'password')).toBe(true)
  })
})

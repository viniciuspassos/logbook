import { PasswordHasherService } from './password-hasher.service'

describe('PasswordHasherService', () => {
  const service = new PasswordHasherService()

  it('hashes a password into a self-describing scrypt string', async () => {
    const hash = await service.hash('correct horse battery staple')

    expect(hash).toMatch(/^scrypt\$\d+\$[0-9a-f]+\$[0-9a-f]+$/)
  })

  it('produces a different hash for the same password each time (random salt)', async () => {
    const [first, second] = await Promise.all([
      service.hash('same password'),
      service.hash('same password'),
    ])

    expect(first).not.toBe(second)
  })

  it('verifies a matching password against its hash', async () => {
    const hash = await service.hash('correct horse battery staple')

    await expect(service.verify('correct horse battery staple', hash)).resolves.toBe(true)
  })

  it('rejects a non-matching password', async () => {
    const hash = await service.hash('correct horse battery staple')

    await expect(service.verify('wrong password', hash)).resolves.toBe(false)
  })

  it('rejects a malformed stored hash instead of throwing', async () => {
    await expect(service.verify('anything', 'not-a-valid-hash')).resolves.toBe(false)
  })

  it('rejects a stored hash using an unrecognised algorithm tag', async () => {
    await expect(
      service.verify('anything', 'md5$1$aabb$ccdd'),
    ).resolves.toBe(false)
  })
})

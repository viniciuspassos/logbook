import type { ConfigService } from '@nestjs/config'
import type { AppConfig } from '../config/configuration'
import { AuthConfigService } from './auth-config.service'

function serviceFor(overrides: Partial<AppConfig>): AuthConfigService {
  const app = {
    googleAuthEnabled: false,
    googleClientId: '',
    allowedEmails: [],
    ...overrides,
  }
  return new AuthConfigService({
    getOrThrow: jest.fn().mockReturnValue(app),
  } as unknown as ConfigService)
}

describe('AuthConfigService', () => {
  it('lists no login methods when Google login is off', () => {
    expect(serviceFor({ googleAuthEnabled: false }).getMethods()).toEqual([])
  })

  it('lists the google method with the client ID when Google login is on', () => {
    const service = serviceFor({ googleAuthEnabled: true, googleClientId: 'client-id' })

    expect(service.getMethods()).toEqual([{ type: 'google', clientId: 'client-id' }])
  })

  it('never leaks the allowlist or the flag state, in either mode', () => {
    for (const googleAuthEnabled of [true, false]) {
      const service = serviceFor({
        googleAuthEnabled,
        googleClientId: 'client-id',
        allowedEmails: ['secret-allowed@example.com'],
      })

      const json = JSON.stringify(service.getMethods())

      expect(json).not.toContain('secret-allowed')
      expect(json).not.toContain('allowedEmails')
    }
  })

  it('returns no client ID at all when off, even if one is configured', () => {
    const json = JSON.stringify(
      serviceFor({ googleAuthEnabled: false, googleClientId: 'leaky-if-returned' }).getMethods(),
    )

    expect(json).not.toContain('leaky-if-returned')
  })
})

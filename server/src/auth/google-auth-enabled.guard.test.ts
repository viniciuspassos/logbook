import { NotFoundException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { GoogleAuthEnabledGuard } from './google-auth-enabled.guard'

function makeConfigService(googleAuthEnabled: boolean): ConfigService {
  return {
    getOrThrow: jest.fn().mockReturnValue({ googleAuthEnabled }),
  } as unknown as ConfigService
}

describe('GoogleAuthEnabledGuard', () => {
  it('lets the request through when Google login is enabled', () => {
    expect(new GoogleAuthEnabledGuard(makeConfigService(true)).canActivate()).toBe(true)
  })

  it('answers 404, as if the route did not exist, when Google login is disabled', () => {
    expect(() => new GoogleAuthEnabledGuard(makeConfigService(false)).canActivate()).toThrow(
      NotFoundException,
    )
  })
})

import type { Response } from 'express'
import { AuthConfigController } from './auth-config.controller'
import type { AuthConfigService } from './auth-config.service'
import { IS_PUBLIC_KEY } from './public.decorator'

function makeResMock() {
  return { setHeader: jest.fn() } as unknown as jest.Mocked<Response>
}

describe('AuthConfigController', () => {
  it('returns the methods list the service builds, wrapped as { methods }', () => {
    const authConfigService = {
      getMethods: jest.fn().mockReturnValue([{ type: 'google', clientId: 'client-id' }]),
    } as unknown as jest.Mocked<AuthConfigService>
    const controller = new AuthConfigController(authConfigService)

    expect(controller.config(makeResMock())).toEqual({
      methods: [{ type: 'google', clientId: 'client-id' }],
    })
  })

  it('returns an empty methods list when no method is available', () => {
    const authConfigService = {
      getMethods: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<AuthConfigService>

    expect(new AuthConfigController(authConfigService).config(makeResMock())).toEqual({
      methods: [],
    })
  })

  it('marks the response Cache-Control: no-store so a flag flip is seen immediately', () => {
    const authConfigService = {
      getMethods: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<AuthConfigService>
    const res = makeResMock()

    new AuthConfigController(authConfigService).config(res)

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
  })

  it('is public: readable with no session and no CSRF header', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AuthConfigController.prototype.config)).toBe(true)
  })
})

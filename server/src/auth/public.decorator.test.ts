import { Reflector } from '@nestjs/core'
import { IS_PUBLIC_KEY, Public } from './public.decorator'

describe('Public', () => {
  class TestController {
    @Public()
    publicHandler(): void {
      /* no-op */
    }

    protectedHandler(): void {
      /* no-op */
    }
  }

  it('marks a decorated handler with the isPublic metadata key', () => {
    const reflector = new Reflector()

    const isPublic = reflector.get<boolean>(
      IS_PUBLIC_KEY,
      TestController.prototype.publicHandler,
    )

    expect(isPublic).toBe(true)
  })

  it('leaves an undecorated handler without the metadata', () => {
    const reflector = new Reflector()

    const isPublic = reflector.get<boolean>(
      IS_PUBLIC_KEY,
      TestController.prototype.protectedHandler,
    )

    expect(isPublic).toBeUndefined()
  })
})

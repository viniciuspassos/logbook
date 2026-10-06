import { Reflector } from '@nestjs/core'
import { IS_SESSION_OPTIONAL_KEY, OptionalSession } from './optional-session.decorator'

describe('OptionalSession', () => {
  class TestController {
    @OptionalSession()
    optionalHandler(): void {
      /* no-op */
    }

    protectedHandler(): void {
      /* no-op */
    }
  }

  it('marks a decorated handler with the optional-session metadata key', () => {
    const reflector = new Reflector()

    expect(
      reflector.get<boolean>(IS_SESSION_OPTIONAL_KEY, TestController.prototype.optionalHandler),
    ).toBe(true)
  })

  it('leaves an undecorated handler without the metadata', () => {
    const reflector = new Reflector()

    expect(
      reflector.get<boolean>(IS_SESSION_OPTIONAL_KEY, TestController.prototype.protectedHandler),
    ).toBeUndefined()
  })
})

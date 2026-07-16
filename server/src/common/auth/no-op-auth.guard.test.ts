import type { ExecutionContext } from '@nestjs/common'
import { NoopAuthGuard } from './no-op-auth.guard'

describe('NoopAuthGuard', () => {
  it('always allows the request through (auth is not implemented yet)', () => {
    const guard = new NoopAuthGuard()
    const context = {} as ExecutionContext

    expect(guard.canActivate(context)).toBe(true)
  })
})

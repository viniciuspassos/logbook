import { UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import { extractUserId } from './current-user.decorator'

function contextFor(request: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
}

describe('extractUserId', () => {
  it("returns the authenticated user's id the session guard attached to the request", () => {
    expect(extractUserId(undefined, contextFor({ userId: 7 }))).toBe(7)
  })

  it('fails closed with 401 when no user id is attached (guard did not run or the route is public)', () => {
    expect(() => extractUserId(undefined, contextFor({}))).toThrow(UnauthorizedException)
  })
})

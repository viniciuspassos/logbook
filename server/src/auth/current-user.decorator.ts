import { UnauthorizedException, createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { RequestWithSession } from './request-with-session'

/**
 * Reads the id of the signed-in user that SessionAuthGuard attached to the
 * request. Fails closed: if it is ever missing on a handler that asks for it
 * (a route wrongly marked `@Public()`), that is a 401, never an unscoped query.
 */
export function extractUserId(_data: unknown, context: ExecutionContext): number {
  const { userId } = context.switchToHttp().getRequest<RequestWithSession>()
  if (userId === undefined) {
    throw new UnauthorizedException('Authentication required')
  }
  return userId
}

/** `@CurrentUserId() userId: number` — the id every per-user query is scoped by. */
export const CurrentUserId = createParamDecorator(extractUserId)

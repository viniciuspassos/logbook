import type { Request } from 'express'
import type { Session } from './session.entity'

/**
 * Augmented request shape after SessionAuthGuard has run. `session` and
 * `userId` are only guaranteed to be set on routes that aren't `@Public()` —
 * guards/handlers downstream (e.g. CsrfGuard, `@CurrentUserId()`) that read
 * them must still handle them being absent, since Nest doesn't encode guard
 * execution order in the type system.
 */
export interface RequestWithSession extends Request {
  session?: Session
  /** The signed-in user's id (the session's `userId`); scope every query by it. */
  userId?: number
}

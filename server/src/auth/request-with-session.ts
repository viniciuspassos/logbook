import type { Request } from 'express'
import type { Session } from './session.entity'

/**
 * Augmented request shape after SessionAuthGuard has run. `session` is only
 * guaranteed to be set on routes that aren't `@Public()` — guards/handlers
 * downstream (e.g. CsrfGuard) that read it must still handle it being
 * absent, since Nest doesn't encode guard execution order in the type
 * system.
 */
export interface RequestWithSession extends Request {
  session?: Session
}

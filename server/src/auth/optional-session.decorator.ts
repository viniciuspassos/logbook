import { SetMetadata } from '@nestjs/common'

export const IS_SESSION_OPTIONAL_KEY = 'isSessionOptional'

/**
 * Marks a route that must work with or without a valid session (logout).
 * SessionAuthGuard attaches the session when the cookie is valid and never
 * answers 401 for these routes; CsrfGuard then enforces the CSRF header only
 * when a session was attached. Unlike `@Public()` this does not bypass CSRF
 * for a caller that does have a live session, so a cross-site request can't
 * act on someone else's session.
 */
export const OptionalSession = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_SESSION_OPTIONAL_KEY, true)

import { SetMetadata } from '@nestjs/common'

export const IS_PUBLIC_KEY = 'isPublic'

/**
 * Opt-out of the global SessionAuthGuard/CsrfGuard for a specific route
 * (health, login). Everything else is protected by default — see
 * session-auth.guard.ts for why "protect by default, opt out explicitly" was
 * chosen over per-controller `@UseGuards()`.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true)

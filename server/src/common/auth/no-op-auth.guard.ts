import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common'

/**
 * DEFERRED (explicitly out of scope for this pass, see server persistence
 * PR description): this is a documented extension seam for auth, not a real
 * implementation. It currently allows every request through unconditionally.
 *
 * It is NOT wired up anywhere yet (no `app.useGlobalGuards`, no `@UseGuards`
 * on a controller) — it exists only so a future auth pass has an obvious
 * place to land: implement `canActivate` for real (e.g. verify a bearer
 * token / API key against a request header), then either:
 *   - register it globally in main.ts via `app.useGlobalGuards(...)`, or
 *   - apply it per-controller/route via `@UseGuards(RealAuthGuard)`.
 */
@Injectable()
export class NoopAuthGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true
  }
}

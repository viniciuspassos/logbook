/**
 * Which login the server wants, as the client understands it.
 *
 * Authentication is the backend's responsibility: the frontend owns no flag
 * and no client ID. It asks `GET /auth/config`, which answers
 * `{ methods: [] }` (login is off) or
 * `{ methods: [{ type: 'google', clientId }] }`. The list shape leaves room for
 * more login types; today only `google` is understood and anything else is
 * ignored. This module is pure: parsing, the derived mode, and the small
 * state shape `useAuthConfig` keeps.
 */

export interface GoogleMethod {
  type: 'google'
  clientId: string
}

export interface AuthConfig {
  methods: GoogleMethod[]
}

/**
 * - `loading`: not asked yet. - `none`: the server has login off, so local-only.
 * - `google`: the server wants Google sign-in. - `unknown`: couldn't ask and
 *   nothing is cached; the app opens local-only rather than trapping an
 *   offline user, and asks again when connectivity returns.
 * - `mock`: `npm run dev:mocked` (sample data, no backend).
 */
export type AuthMode = 'loading' | 'none' | 'google' | 'unknown' | 'mock'

export type ConfigState =
  | { status: 'loading' }
  | { status: 'unknown' }
  | { status: 'known'; config: AuthConfig }

export const LOADING_CONFIG: ConfigState = { status: 'loading' }
export const UNKNOWN_CONFIG: ConfigState = { status: 'unknown' }

export function knownConfig(config: AuthConfig): ConfigState {
  return { status: 'known', config }
}

function parseMethod(value: unknown): GoogleMethod | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  if (candidate.type !== 'google' || typeof candidate.clientId !== 'string') return null
  const clientId = candidate.clientId.trim()
  return clientId === '' ? null : { type: 'google', clientId }
}

/**
 * Validates a `GET /auth/config` body. Only a well-formed `{ methods: [] }`
 * means login is off. Unusable *methods* are dropped, but if methods are listed
 * and none survives (a google method with no client ID, only types we don't
 * know), or the body isn't `{ methods: [...] }` at all, the answer is `null`,
 * meaning "unknown": a garbled or too-new answer must never switch login off
 * (and is never cached as if it had).
 */
export function parseAuthConfig(value: unknown): AuthConfig | null {
  if (typeof value !== 'object' || value === null) return null
  const { methods } = value as { methods?: unknown }
  if (!Array.isArray(methods)) return null
  const usable = methods.map(parseMethod).filter((method): method is GoogleMethod => method !== null)
  if (methods.length > 0 && usable.length === 0) return null
  return { methods: usable }
}

/** The Google client ID the server gave, if it offers Google login. */
export function googleClientIdOf(config: AuthConfig): string | null {
  return config.methods.find((method) => method.type === 'google')?.clientId ?? null
}

export function modeOfConfigState(state: ConfigState): Exclude<AuthMode, 'mock'> {
  if (state.status !== 'known') return state.status
  return googleClientIdOf(state.config) === null ? 'none' : 'google'
}

export function sameConfigState(a: ConfigState, b: ConfigState): boolean {
  if (a.status !== 'known' || b.status !== 'known') return a.status === b.status
  return JSON.stringify(a.config) === JSON.stringify(b.config)
}

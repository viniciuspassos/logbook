/**
 * API base URL for the backend the frontend optionally syncs to (#26).
 *
 * Deliberately NOT read from `import.meta.env`: this repo's Jest config
 * transforms every file through Babel to CommonJS, which cannot represent
 * `import.meta` (Babel leaves it in place and Node's CJS loader then throws
 * "Cannot use 'import.meta' outside a module" the instant such a file is
 * required — even from a test that never touches this function). A
 * `window`-scoped override sidesteps that entirely, is trivially unit
 * testable, and — for a self-hosted single-user app like this one — is
 * arguably more useful anyway: an operator can point a static build at a
 * different backend by editing a small inline script in `index.html` (or
 * serving a tiny `config.js` before the app bundle) without a rebuild. See
 * `vite.config.ts`'s dev proxy for how `/api` resolves in development.
 */

declare global {
  interface Window {
    __LOGBOOK_API_BASE_URL__?: string
  }
}

const DEFAULT_API_BASE_URL = '/api'

/** The configured API base URL, or the same-origin `/api` default. */
export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const override = window.__LOGBOOK_API_BASE_URL__
    if (typeof override === 'string' && override.trim() !== '') {
      return override
    }
  }
  return DEFAULT_API_BASE_URL
}

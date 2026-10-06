/**
 * The Google OAuth Web client ID for "Sign in with Google".
 *
 * Read from a `window` global rather than `import.meta.env` for the same
 * reason as `src/lib/sync/config.ts`: this repo's Jest config transpiles to
 * CommonJS, which cannot represent `import.meta`. It also lets an operator
 * set the ID in a small inline script in `index.html` (or a `config.js`
 * served before the bundle) without rebuilding. A client ID is public by
 * design, so exposing it to the page is fine.
 */

declare global {
  interface Window {
    __LOGBOOK_GOOGLE_CLIENT_ID__?: string
  }
}

/** The configured client ID, or `null` when none is set (sign-in unavailable). */
export function getGoogleClientId(): string | null {
  if (typeof window === 'undefined') return null
  const value = window.__LOGBOOK_GOOGLE_CLIENT_ID__
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  return null
}

/**
 * Whether the app should seed a fresh, empty store with the sample entries in
 * `src/data/entries.ts` instead of starting from a real, empty timeline.
 *
 * Set at dev/build time via `npm run dev:mocked` (`vite --mode mocked`) — see
 * vite.config.ts, which injects `__LOGBOOK_MOCKED__` via `define` when Vite's
 * `mode` is `"mocked"` — rather than read from
 * `import.meta.env`: this repo's Jest config transforms every file through
 * Babel to CommonJS, which cannot represent `import.meta` — see
 * src/lib/sync/config.ts's `getApiBaseUrl` for the same constraint. The
 * `typeof` guard keeps this safe under Jest, where the global is never
 * defined and the app is expected to behave like a real (unmocked) run.
 */
declare global {
  var __LOGBOOK_MOCKED__: boolean | undefined
}

export function shouldUseMockData(): boolean {
  return typeof __LOGBOOK_MOCKED__ !== 'undefined' && __LOGBOOK_MOCKED__ === true
}

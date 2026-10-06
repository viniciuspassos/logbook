/**
 * Calls `listener` whenever the browser regains connectivity (the `online`
 * event); returns the cleanup. Guarded so environments without `window` get a
 * no-op, same as `startAutoSync` in outboxRunner.ts. This is where hooks that
 * need "retry when we're back online" (e.g. the auth config) get it, so they
 * never touch `window` themselves.
 */
export function onBackOnline(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('online', listener)
  return () => window.removeEventListener('online', listener)
}

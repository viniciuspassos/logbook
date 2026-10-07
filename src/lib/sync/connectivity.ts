/**
 * Calls `listener` when the app may be able to reach the server again: the
 * browser comes back online, the window regains focus, or the tab becomes
 * visible. These often fire together, so callers guard against overlapping
 * attempts. Returns the cleanup. Guarded so environments without `window` get
 * a no-op, same as `startAutoSync` in outboxRunner.ts. This is where hooks
 * that need "try again now" get it, so they never touch `window` themselves.
 */
export function onBackOnline(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onVisible = () => {
    if (document.visibilityState === 'visible') listener()
  }
  window.addEventListener('online', listener)
  window.addEventListener('focus', listener)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('focus', listener)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

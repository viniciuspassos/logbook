/**
 * Calls `listener` when the server may be reachable again (online, window focus,
 * tab visible; they often fire together, so callers guard against overlap).
 * Returns the cleanup; a no-op without `window`. Hooks never touch `window`.
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

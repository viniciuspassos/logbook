import { useEffect, useState } from 'react'

const DESKTOP_QUERY = '(min-width: 960px)'

function matchesDesktop(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(DESKTOP_QUERY).matches
    : false
}

/**
 * Mirrors the `min-width: 960px` breakpoint that reflows the app from a
 * single mobile card into the two-page desktop layout (src/App.css). Layout
 * itself stays pure CSS; this only exists because keeping the nav rail
 * reachable while an overlay is open depends on real viewport width, which
 * CSS alone can't express as a mount/unmount decision. Guards `matchMedia`
 * the same way the AI/speech wrappers guard their globals, so jsdom (which
 * has no `matchMedia`) safely falls back to "not desktop".
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(matchesDesktop)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(DESKTOP_QUERY)
    const onChange = () => setIsDesktop(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isDesktop
}

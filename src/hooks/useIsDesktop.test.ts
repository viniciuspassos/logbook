import { act, renderHook } from '@testing-library/react'
import { useIsDesktop } from './useIsDesktop.ts'

type Listener = () => void

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<Listener>()
  const mql = {
    get matches() {
      return matches
    },
    media: '(min-width: 960px)',
    addEventListener: (_event: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_event: string, listener: Listener) => listeners.delete(listener),
  }
  window.matchMedia = jest.fn().mockReturnValue(mql)
  return {
    setMatches: (next: boolean) => {
      matches = next
      listeners.forEach((listener) => listener())
    },
  }
}

describe('useIsDesktop', () => {
  const originalMatchMedia = window.matchMedia

  afterEach(() => {
    if (originalMatchMedia) {
      window.matchMedia = originalMatchMedia
    } else {
      // @ts-expect-error jsdom has no matchMedia by default; restore that absence
      delete window.matchMedia
    }
  })

  it('reports false when matchMedia is unavailable (jsdom default)', () => {
    // @ts-expect-error simulating an environment without matchMedia
    delete window.matchMedia
    const { result } = renderHook(() => useIsDesktop())
    expect(result.current).toBe(false)
  })

  it('reflects the initial match state', () => {
    installMatchMedia(true)
    const { result } = renderHook(() => useIsDesktop())
    expect(result.current).toBe(true)
  })

  it('updates when the media query match changes', () => {
    const { setMatches } = installMatchMedia(false)
    const { result } = renderHook(() => useIsDesktop())
    expect(result.current).toBe(false)

    act(() => setMatches(true))
    expect(result.current).toBe(true)

    act(() => setMatches(false))
    expect(result.current).toBe(false)
  })
})

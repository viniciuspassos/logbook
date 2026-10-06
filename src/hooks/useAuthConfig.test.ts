import { act, renderHook, waitFor } from '@testing-library/react'
import { useAuthConfig } from './useAuthConfig.ts'
import { getAuthConfig } from '../lib/sync/authApi.ts'
import { getCachedAuthConfig, putCachedAuthConfig } from '../lib/db/identityStore.ts'
import { hasLocalData } from '../lib/db/localOwner.ts'
import { onBackOnline } from '../lib/sync/connectivity.ts'
import { LOCAL_PROBE_TIMEOUT_MS, RESTORE_TIMEOUT_MS } from '../lib/auth/sessionFlows.ts'
import type { AuthConfig } from '../lib/auth/authConfig.ts'

jest.mock('../lib/sync/authApi.ts')
jest.mock('../lib/db/identityStore.ts')
jest.mock('../lib/db/localOwner.ts')
jest.mock('../lib/sync/connectivity.ts')

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.Mock

const google: AuthConfig = { methods: [{ type: 'google', clientId: 'id.apps.googleusercontent.com' }] }
const none: AuthConfig = { methods: [] }

let onlineListeners: Array<() => void> = []

function goOnline() {
  act(() => onlineListeners.forEach((listener) => listener()))
}

beforeEach(() => {
  jest.resetAllMocks()
  onlineListeners = []
  mocked(onBackOnline).mockImplementation((listener: () => void) => {
    onlineListeners.push(listener)
    return () => {
      onlineListeners = onlineListeners.filter((l) => l !== listener)
    }
  })
  mocked(getCachedAuthConfig).mockResolvedValue(null)
  mocked(putCachedAuthConfig).mockResolvedValue(undefined)
  mocked(getAuthConfig).mockResolvedValue(google)
  mocked(hasLocalData).mockResolvedValue(false)
})

afterEach(() => {
  delete (globalThis as { __LOGBOOK_MOCKED__?: boolean }).__LOGBOOK_MOCKED__
  jest.useRealTimers()
})

describe('useAuthConfig: online, no cache', () => {
  it('starts "loading", then follows the server: google, with the client ID it gave', async () => {
    const { result } = renderHook(() => useAuthConfig())
    expect(result.current.mode).toBe('loading')

    await waitFor(() => expect(result.current.mode).toBe('google'))
    expect(result.current.googleClientId).toBe('id.apps.googleusercontent.com')
    expect(putCachedAuthConfig).toHaveBeenCalledWith(google)
  })

  it('is "none" (local-only) when the server has login off', async () => {
    mocked(getAuthConfig).mockResolvedValue(none)
    const { result } = renderHook(() => useAuthConfig())

    await waitFor(() => expect(result.current.mode).toBe('none'))
    expect(result.current.googleClientId).toBeNull()
  })
})

describe('useAuthConfig: when the server cannot answer', () => {
  it('decides from the cached config, instantly, even if the request is still pending', async () => {
    mocked(getCachedAuthConfig).mockResolvedValue(google)
    mocked(getAuthConfig).mockReturnValue(new Promise(() => undefined))
    const { result } = renderHook(() => useAuthConfig())

    await waitFor(() => expect(result.current.mode).toBe('google'))
  })

  it('keeps the cached config when the request fails (offline reopen)', async () => {
    mocked(getCachedAuthConfig).mockResolvedValue(none)
    mocked(getAuthConfig).mockResolvedValue(null)
    const { result } = renderHook(() => useAuthConfig())

    await waitFor(() => expect(getAuthConfig).toHaveBeenCalled())
    await act(async () => {})
    expect(result.current.mode).toBe('none')
  })

  it('takes the fresh answer over the cache (cached google, server now says none)', async () => {
    mocked(getCachedAuthConfig).mockResolvedValue(google)
    mocked(getAuthConfig).mockResolvedValue(none)
    const { result } = renderHook(() => useAuthConfig())

    await waitFor(() => expect(result.current.mode).toBe('none'))
  })

  it('is "unknown" with no cache, never a dead end', async () => {
    mocked(getAuthConfig).mockResolvedValue(null)
    const { result } = renderHook(() => useAuthConfig())

    await waitFor(() => expect(result.current.mode).toBe('unknown'))
    expect(result.current.googleClientId).toBeNull()
  })

  it('asks again when connectivity returns, and settles on the answer', async () => {
    mocked(getAuthConfig).mockResolvedValueOnce(null)
    const { result } = renderHook(() => useAuthConfig())
    await waitFor(() => expect(result.current.mode).toBe('unknown'))

    mocked(getAuthConfig).mockResolvedValue(google)
    goOnline()

    await waitFor(() => expect(result.current.mode).toBe('google'))
    expect(onlineListeners).toHaveLength(0)
  })

  it('stays "unknown" if it is still unreachable when connectivity returns', async () => {
    mocked(getAuthConfig).mockResolvedValue(null)
    const { result } = renderHook(() => useAuthConfig())
    await waitFor(() => expect(result.current.mode).toBe('unknown'))

    goOnline()
    await act(async () => {})

    expect(result.current.mode).toBe('unknown')
    expect(onlineListeners).toHaveLength(1)
  })

  it('does not listen for connectivity once the mode is known', async () => {
    renderHook(() => useAuthConfig())
    await waitFor(() => expect(getAuthConfig).toHaveBeenCalled())
    await act(async () => {})
    expect(onBackOnline).not.toHaveBeenCalled()
  })
})

describe('useAuthConfig: a slow startup', () => {
  beforeEach(() => jest.useFakeTimers())

  async function advance(ms: number) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms)
    })
  }

  it('opens as "unknown" (local-only) after the timeout for an existing user with local data', async () => {
    mocked(getAuthConfig).mockReturnValue(new Promise(() => undefined))
    mocked(hasLocalData).mockResolvedValue(true)
    const { result } = renderHook(() => useAuthConfig())

    await advance(RESTORE_TIMEOUT_MS)

    expect(result.current.mode).toBe('unknown')
  })

  it('keeps a first-time user (nothing local) on the splash until the server answers', async () => {
    let resolveConfig: ((config: AuthConfig) => void) | undefined
    mocked(getAuthConfig).mockReturnValue(new Promise((resolve) => (resolveConfig = resolve)))
    const { result } = renderHook(() => useAuthConfig())

    await advance(RESTORE_TIMEOUT_MS + LOCAL_PROBE_TIMEOUT_MS)
    expect(result.current.mode).toBe('loading')

    await act(async () => resolveConfig?.(google))
    expect(result.current.mode).toBe('google')
  })

  it('opens as "unknown" rather than trapping anyone when storage itself is stuck', async () => {
    mocked(getCachedAuthConfig).mockReturnValue(new Promise(() => undefined))
    mocked(hasLocalData).mockReturnValue(new Promise(() => undefined))
    const { result } = renderHook(() => useAuthConfig())

    await advance(RESTORE_TIMEOUT_MS + LOCAL_PROBE_TIMEOUT_MS)

    expect(result.current.mode).toBe('unknown')
  })

  it('does not let the timeout overwrite an answer that already arrived', async () => {
    mocked(getAuthConfig).mockResolvedValue(none)
    mocked(hasLocalData).mockResolvedValue(true)
    const { result } = renderHook(() => useAuthConfig())
    await advance(10)
    expect(result.current.mode).toBe('none')

    await advance(RESTORE_TIMEOUT_MS + LOCAL_PROBE_TIMEOUT_MS)

    expect(result.current.mode).toBe('none')
  })
})

describe('useAuthConfig: other cases', () => {
  it('is "mock" under dev:mocked and never asks the server', () => {
    ;(globalThis as { __LOGBOOK_MOCKED__?: boolean }).__LOGBOOK_MOCKED__ = true
    const { result } = renderHook(() => useAuthConfig())
    expect(result.current).toEqual({ mode: 'mock', googleClientId: null })
    expect(getAuthConfig).not.toHaveBeenCalled()
  })

  it('aborts the request on unmount and applies nothing afterwards', async () => {
    let resolveConfig: ((config: AuthConfig) => void) | undefined
    mocked(getAuthConfig).mockReturnValue(new Promise((resolve) => (resolveConfig = resolve)))
    const { result, unmount } = renderHook(() => useAuthConfig())
    await waitFor(() => expect(getAuthConfig).toHaveBeenCalled())
    const signal = mocked(getAuthConfig).mock.calls[0][0] as AbortSignal

    unmount()
    await act(async () => resolveConfig?.(google))

    expect(signal.aborted).toBe(true)
    expect(result.current.mode).toBe('loading')
  })
})

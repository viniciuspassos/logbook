import { act, renderHook, waitFor } from '@testing-library/react'
import { useAuth } from './useAuth.ts'
import { getMe, loginWithGoogle, logout } from '../lib/sync/authApi.ts'
import { disableGoogleAutoSelect } from '../lib/auth/googleIdentity.ts'
import { clearCachedIdentity, getCachedIdentity, putCachedIdentity } from '../lib/db/identityStore.ts'
import { drainOutbox } from '../lib/sync/outboxRunner.ts'
import { SyncAuthError, SyncHttpError, SyncNetworkError } from '../lib/sync/errors.ts'
import type { AuthProfile } from '../types/auth.ts'

jest.mock('../lib/sync/authApi.ts', () => ({
  loginWithGoogle: jest.fn(),
  getMe: jest.fn(),
  logout: jest.fn(),
}))
jest.mock('../lib/auth/googleIdentity.ts', () => ({
  disableGoogleAutoSelect: jest.fn(),
}))
jest.mock('../lib/db/identityStore.ts', () => ({
  getCachedIdentity: jest.fn(),
  putCachedIdentity: jest.fn(),
  clearCachedIdentity: jest.fn(),
}))
jest.mock('../lib/sync/outboxRunner.ts', () => ({
  drainOutbox: jest.fn().mockResolvedValue({ processed: 0, stoppedReason: 'empty' }),
}))

const getMeMock = getMe as jest.Mock
const loginMock = loginWithGoogle as jest.Mock
const logoutMock = logout as jest.Mock
const getCachedMock = getCachedIdentity as jest.Mock
const putCachedMock = putCachedIdentity as jest.Mock
const clearCachedMock = clearCachedIdentity as jest.Mock
const drainMock = drainOutbox as jest.Mock
const autoSelectMock = disableGoogleAutoSelect as jest.Mock

const ada: AuthProfile = { id: 'u1', email: 'ada@example.com', name: 'Ada', picture: null }
const grace: AuthProfile = { id: 'u2', email: 'grace@example.com', name: 'Grace', picture: null }

beforeEach(() => {
  jest.clearAllMocks()
  getCachedMock.mockResolvedValue(null)
  getMeMock.mockResolvedValue(ada)
  loginMock.mockResolvedValue({ status: 'ok' })
  logoutMock.mockResolvedValue({ status: 'ok' })
  putCachedMock.mockResolvedValue(undefined)
  clearCachedMock.mockResolvedValue(undefined)
  drainMock.mockResolvedValue({ processed: 0, stoppedReason: 'empty' })
})

afterEach(() => {
  delete (globalThis as { __LOGBOOK_MOCKED__?: boolean }).__LOGBOOK_MOCKED__
})

describe('useAuth: resolving the session on mount', () => {
  it('starts in "loading"', async () => {
    const { result } = renderHook(() => useAuth())
    expect(result.current.state).toBe('loading')
    expect(result.current.profile).toBeNull()
    await waitFor(() => expect(result.current.state).toBe('signedIn'))
  })

  it('is signed in with the server profile when GET /auth/me succeeds, and caches it', async () => {
    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(result.current.state).toBe('signedIn'))
    expect(result.current.profile).toEqual(ada)
    expect(putCachedMock).toHaveBeenCalledWith(ada)
  })

  it('is signed out when there is no session (401) and no cached identity', async () => {
    getMeMock.mockRejectedValue(new SyncAuthError(401, null))
    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(result.current.state).toBe('signedOut'))
    expect(result.current.profile).toBeNull()
  })

  it('opens from the cached identity without waiting for the network', async () => {
    getCachedMock.mockResolvedValue(grace)
    getMeMock.mockReturnValue(new Promise(() => undefined))
    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(result.current.state).toBe('signedIn'))
    expect(result.current.profile).toEqual(grace)
  })

  it('stays signed in from the cache when the backend is unreachable (offline reopen)', async () => {
    getCachedMock.mockResolvedValue(grace)
    getMeMock.mockRejectedValue(new SyncNetworkError())
    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(getMeMock).toHaveBeenCalled())
    await waitFor(() => expect(result.current.state).toBe('signedIn'))
    expect(result.current.profile).toEqual(grace)
  })

  it('returns to the gate on a 401 even with a cached identity, leaving the cache for the next offline open', async () => {
    getCachedMock.mockResolvedValue(grace)
    getMeMock.mockRejectedValue(new SyncAuthError(401, null))
    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(result.current.state).toBe('signedOut'))
    expect(clearCachedMock).not.toHaveBeenCalled()
  })

  it('is signed out (the gate) when the backend is unreachable and nobody has signed in here', async () => {
    getMeMock.mockRejectedValue(new SyncNetworkError())
    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(result.current.state).toBe('signedOut'))
  })

  it('does not update state after unmounting', async () => {
    let resolveMe: ((profile: AuthProfile) => void) | undefined
    getMeMock.mockReturnValue(new Promise((resolve) => (resolveMe = resolve)))
    const { result, unmount } = renderHook(() => useAuth())
    await waitFor(() => expect(getMeMock).toHaveBeenCalled())

    unmount()
    await act(async () => resolveMe?.(ada))

    expect(result.current.state).toBe('loading')
  })

  it('passes an abort signal to GET /auth/me and aborts it on unmount', async () => {
    const { unmount } = renderHook(() => useAuth())
    await waitFor(() => expect(getMeMock).toHaveBeenCalled())
    const signal = getMeMock.mock.calls[0][0] as AbortSignal

    unmount()

    expect(signal.aborted).toBe(true)
  })

  it('skips the gate under `dev:mocked` (sample data, no backend)', () => {
    ;(globalThis as { __LOGBOOK_MOCKED__?: boolean }).__LOGBOOK_MOCKED__ = true
    const { result } = renderHook(() => useAuth())
    expect(result.current.state).toBe('signedIn')
    expect(getMeMock).not.toHaveBeenCalled()
  })
})

describe('useAuth: signInWithGoogle', () => {
  async function renderSignedOut() {
    getMeMock.mockRejectedValueOnce(new SyncAuthError(401, null))
    const hook = renderHook(() => useAuth())
    await waitFor(() => expect(hook.result.current.state).toBe('signedOut'))
    getMeMock.mockResolvedValue(ada)
    return hook
  }

  it('exchanges the ID token, loads the profile, caches it and signs in', async () => {
    const { result } = await renderSignedOut()

    let outcome: boolean | undefined
    await act(async () => {
      outcome = await result.current.signInWithGoogle('id-token')
    })

    expect(loginMock).toHaveBeenCalledWith('id-token')
    expect(outcome).toBe(true)
    expect(result.current.state).toBe('signedIn')
    expect(result.current.profile).toEqual(ada)
    expect(putCachedMock).toHaveBeenCalledWith(ada)
  })

  it('drains the outbox after signing in, so anything queued while signed out goes through', async () => {
    const { result } = await renderSignedOut()
    await act(async () => {
      await result.current.signInWithGoogle('id-token')
    })
    expect(drainMock).toHaveBeenCalled()
  })

  it('is pending while the request is in flight', async () => {
    const { result } = await renderSignedOut()
    let resolveLogin: (() => void) | undefined
    loginMock.mockReturnValue(new Promise((resolve) => (resolveLogin = () => resolve({ status: 'ok' }))))

    act(() => {
      void result.current.signInWithGoogle('id-token')
    })
    expect(result.current.pending).toBe(true)

    await act(async () => resolveLogin?.())
    await waitFor(() => expect(result.current.pending).toBe(false))
  })

  it.each([
    ['an account that is not allowed (403)', new SyncAuthError(403, null), "This Google account isn't allowed to use this Logbook."],
    ['a rejected token (401)', new SyncAuthError(401, null), 'Sign-in expired. Try again.'],
    ['an unreachable server', new SyncNetworkError(), "Couldn't reach the Logbook server. Check your connection and try again."],
    ['any other failure', new SyncHttpError(500, null, 'boom'), 'Something went wrong. Try again.'],
  ])('stays signed out with a plain message for %s', async (_label, failure, message) => {
    const { result } = await renderSignedOut()
    loginMock.mockRejectedValue(failure)

    let outcome: boolean | undefined
    await act(async () => {
      outcome = await result.current.signInWithGoogle('id-token')
    })

    expect(outcome).toBe(false)
    expect(result.current.state).toBe('signedOut')
    expect(result.current.error).toBe(message)
    expect(putCachedMock).not.toHaveBeenCalled()
  })

  it('clearError dismisses the message', async () => {
    const { result } = await renderSignedOut()
    loginMock.mockRejectedValue(new SyncNetworkError())
    await act(async () => {
      await result.current.signInWithGoogle('id-token')
    })

    act(() => result.current.clearError())

    expect(result.current.error).toBeNull()
  })
})

describe('useAuth: logout', () => {
  async function renderSignedIn() {
    const hook = renderHook(() => useAuth())
    await waitFor(() => expect(hook.result.current.state).toBe('signedIn'))
    return hook
  }

  it('signs out on the server, forgets the cached identity and stops Google auto-select', async () => {
    const { result } = await renderSignedIn()

    await act(async () => {
      await result.current.logout()
    })

    expect(logoutMock).toHaveBeenCalled()
    expect(clearCachedMock).toHaveBeenCalled()
    expect(autoSelectMock).toHaveBeenCalled()
    expect(result.current.state).toBe('signedOut')
    expect(result.current.profile).toBeNull()
  })

  it('still signs out locally when the request fails', async () => {
    const { result } = await renderSignedIn()
    logoutMock.mockRejectedValue(new SyncNetworkError())

    await act(async () => {
      await result.current.logout()
    })

    expect(result.current.state).toBe('signedOut')
    expect(result.current.pending).toBe(false)
  })
})

describe('useAuth: noteAuthRequired', () => {
  it('flips to signed out when a sync attempt finds the session gone, without clearing local identity', async () => {
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.state).toBe('signedIn'))

    act(() => result.current.noteAuthRequired())

    expect(result.current.state).toBe('signedOut')
    expect(clearCachedMock).not.toHaveBeenCalled()
  })
})

import { act, renderHook, waitFor } from '@testing-library/react'
import { RESTORE_TIMEOUT_MS, useAuth, type UseAuthOptions } from './useAuth.ts'
import { getMe, loginWithGoogle, logout } from '../lib/sync/authApi.ts'
import { disableGoogleAutoSelect } from '../lib/auth/googleIdentity.ts'
import {
  clearCachedIdentity,
  clearPendingLogout,
  getCachedIdentity,
  hasPendingLogout,
  putCachedIdentity,
  setPendingLogout,
} from '../lib/db/identityStore.ts'
import { checkLocalOwner, claimLocalData, hasLocalData } from '../lib/db/localOwner.ts'
import { drainOutbox, subscribeToDrains, type DrainSummary } from '../lib/sync/outboxRunner.ts'
import { SyncAuthError, SyncHttpError, SyncNetworkError } from '../lib/sync/errors.ts'
import type { AuthProfile } from '../types/auth.ts'

jest.mock('../lib/sync/authApi.ts')
jest.mock('../lib/auth/googleIdentity.ts', () => ({ disableGoogleAutoSelect: jest.fn() }))
jest.mock('../lib/db/identityStore.ts')
jest.mock('../lib/db/localOwner.ts')
jest.mock('../lib/sync/outboxRunner.ts')

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.Mock

const ada: AuthProfile = { id: 'u1', email: 'ada@example.com', name: 'Ada', picture: null }
const grace: AuthProfile = { id: 'u2', email: 'grace@example.com', name: 'Grace', picture: null }

let drainListeners: Array<(summary: DrainSummary) => void> = []

function emitDrain(summary: DrainSummary) {
  act(() => drainListeners.forEach((listener) => listener(summary)))
}

beforeEach(() => {
  jest.resetAllMocks()
  drainListeners = []
  mocked(subscribeToDrains).mockImplementation((listener: (summary: DrainSummary) => void) => {
    drainListeners.push(listener)
    return () => {
      drainListeners = drainListeners.filter((l) => l !== listener)
    }
  })
  mocked(hasPendingLogout).mockResolvedValue(false)
  mocked(getCachedIdentity).mockResolvedValue(null)
  mocked(getMe).mockResolvedValue(ada)
  mocked(loginWithGoogle).mockResolvedValue({ status: 'ok' })
  mocked(logout).mockResolvedValue({ status: 'ok' })
  mocked(checkLocalOwner).mockResolvedValue('ok')
  mocked(hasLocalData).mockResolvedValue(false)
  mocked(drainOutbox).mockResolvedValue({ processed: 0, stoppedReason: 'empty' })
})

afterEach(() => {
  delete (globalThis as { __LOGBOOK_MOCKED__?: boolean }).__LOGBOOK_MOCKED__
  jest.useRealTimers()
})

async function renderSignedOut(options?: UseAuthOptions) {
  mocked(getMe).mockRejectedValueOnce(new SyncAuthError(401, null))
  const hook = renderHook(() => useAuth(options))
  await waitFor(() => expect(hook.result.current.state).toBe('signedOut'))
  mocked(getMe).mockResolvedValue(ada)
  return hook
}

async function renderSignedIn(options?: UseAuthOptions) {
  const hook = renderHook(() => useAuth(options))
  await waitFor(() => expect(hook.result.current.profile).toEqual(ada))
  return hook
}

describe('useAuth: startup', () => {
  it('starts in "loading", then signs in with the server profile and caches it', async () => {
    const { result } = renderHook(() => useAuth())
    expect(result.current.state).toBe('loading')

    await waitFor(() => expect(result.current.state).toBe('signedIn'))
    expect(result.current.profile).toEqual(ada)
    expect(result.current.unverified).toBe(false)
    expect(putCachedIdentity).toHaveBeenCalledWith(ada)
  })

  it('shows the gate on a 401 with nothing cached', async () => {
    const { result } = await renderSignedOut()
    expect(result.current.profile).toBeNull()
  })

  it('opens from the cached profile without waiting on the network, as unverified', async () => {
    mocked(getCachedIdentity).mockResolvedValue(grace)
    mocked(getMe).mockReturnValue(new Promise(() => undefined))
    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(result.current.state).toBe('signedIn'))
    expect(result.current.profile).toEqual(grace)
    expect(result.current.unverified).toBe(true)
  })

  it('opens offline for an existing user with local entries but no cached identity', async () => {
    mocked(getMe).mockRejectedValue(new SyncNetworkError())
    mocked(hasLocalData).mockResolvedValue(true)
    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(result.current.state).toBe('signedIn'))
    expect(result.current.profile).toBeNull()
    expect(result.current.unverified).toBe(true)
  })

  it('shows the gate when offline with no cache and no local entries', async () => {
    mocked(getMe).mockRejectedValue(new SyncNetworkError())
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.state).toBe('signedOut'))
  })

  it('stays signed out after an offline sign-out: the marker is honoured and getMe never runs', async () => {
    mocked(hasPendingLogout).mockResolvedValue(true)
    mocked(logout).mockRejectedValue(new SyncNetworkError())
    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(result.current.state).toBe('signedOut'))
    expect(getMe).not.toHaveBeenCalled()
  })

  it('shows a different account that owns the device as a pending switch, not as signed in', async () => {
    mocked(checkLocalOwner).mockResolvedValue('mismatch')
    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(result.current.pendingSwitch).toEqual(ada))
    expect(result.current.state).toBe('signedOut')
  })

  it('aborts the startup request on unmount and applies nothing afterwards', async () => {
    let resolveMe: ((profile: AuthProfile) => void) | undefined
    mocked(getMe).mockReturnValue(new Promise((resolve) => (resolveMe = resolve)))
    const { result, unmount } = renderHook(() => useAuth())
    await waitFor(() => expect(getMe).toHaveBeenCalled())
    const signal = mocked(getMe).mock.calls[0][0] as AbortSignal

    unmount()
    await act(async () => resolveMe?.(ada))

    expect(signal.aborted).toBe(true)
    expect(result.current.state).toBe('loading')
    expect(putCachedIdentity).not.toHaveBeenCalled()
  })

  it('skips the gate under `dev:mocked` (sample data, no backend)', () => {
    ;(globalThis as { __LOGBOOK_MOCKED__?: boolean }).__LOGBOOK_MOCKED__ = true
    const { result } = renderHook(() => useAuth())
    expect(result.current.state).toBe('signedIn')
    expect(result.current.unverified).toBe(false)
    expect(getMe).not.toHaveBeenCalled()
  })

  it('opens unverified instead of sitting on the splash forever when startup hangs (e.g. IndexedDB blocked)', async () => {
    jest.useFakeTimers()
    mocked(hasPendingLogout).mockReturnValue(new Promise(() => undefined))
    const { result } = renderHook(() => useAuth())
    expect(result.current.state).toBe('loading')

    act(() => {
      jest.advanceTimersByTime(RESTORE_TIMEOUT_MS)
    })

    expect(result.current.state).toBe('signedIn')
    expect(result.current.unverified).toBe(true)
  })

  it('does not apply the timeout fallback once startup has resolved', async () => {
    jest.useFakeTimers()
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.profile).toEqual(ada))

    act(() => {
      jest.advanceTimersByTime(RESTORE_TIMEOUT_MS)
    })

    expect(result.current.unverified).toBe(false)
  })

  it('opens unverified when startup itself throws', async () => {
    mocked(hasPendingLogout).mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.state).toBe('signedIn'))
    expect(result.current.unverified).toBe(true)
  })
})

describe('useAuth: verifying an unverified session', () => {
  async function renderUnverified() {
    mocked(getCachedIdentity).mockResolvedValue(grace)
    mocked(getMe).mockRejectedValue(new SyncNetworkError())
    const hook = renderHook(() => useAuth())
    await waitFor(() => expect(hook.result.current.unverified).toBe(true))
    await waitFor(() => expect(drainListeners).toHaveLength(1))
    return hook
  }

  it('confirms the profile once a drain reaches the server', async () => {
    const { result } = await renderUnverified()
    mocked(getMe).mockResolvedValue(grace)

    emitDrain({ processed: 0, stoppedReason: 'empty' })

    await waitFor(() => expect(result.current.unverified).toBe(false))
    expect(result.current.profile).toEqual(grace)
  })

  it('ignores a drain that never left the device', async () => {
    const { result } = await renderUnverified()
    mocked(getMe).mockClear()

    emitDrain({ processed: 0, stoppedReason: 'unreachable' })

    expect(getMe).not.toHaveBeenCalled()
    expect(result.current.unverified).toBe(true)
  })

  it('asks the user to sign in again, without a gate, when the server says 401', async () => {
    const { result } = await renderUnverified()
    mocked(getMe).mockRejectedValue(new SyncAuthError(401, null))

    emitDrain({ processed: 0, stoppedReason: 'auth' })

    await waitFor(() => expect(result.current.needsSignIn).toBe(true))
    expect(result.current.state).toBe('signedIn')
  })

  it('stays unverified if the server still cannot be reached', async () => {
    const { result } = await renderUnverified()

    emitDrain({ processed: 0, stoppedReason: 'error', error: 'x' })
    await act(async () => {})

    expect(result.current.unverified).toBe(true)
    expect(result.current.needsSignIn).toBe(false)
  })

  it('drops a verification result that a sign-out has superseded', async () => {
    const { result } = await renderUnverified()
    let resolveMe: ((profile: AuthProfile) => void) | undefined
    mocked(getMe).mockReturnValue(new Promise((resolve) => (resolveMe = resolve)))
    emitDrain({ processed: 0, stoppedReason: 'empty' })

    await act(async () => {
      await result.current.logout()
    })
    await act(async () => resolveMe?.(grace))

    expect(result.current.state).toBe('signedOut')
    expect(result.current.profile).toBeNull()
  })
})

describe('useAuth: signInWithGoogle', () => {
  it('exchanges the token, signs in, caches the profile and drains the outbox', async () => {
    const { result } = await renderSignedOut()

    let outcome: boolean | undefined
    await act(async () => {
      outcome = await result.current.signInWithGoogle('id-token')
    })

    expect(loginWithGoogle).toHaveBeenCalledWith('id-token')
    expect(outcome).toBe(true)
    expect(result.current.state).toBe('signedIn')
    expect(result.current.profile).toEqual(ada)
    expect(putCachedIdentity).toHaveBeenCalledWith(ada)
    expect(drainOutbox).toHaveBeenCalled()
  })

  it('is pending while the request is in flight', async () => {
    const { result } = await renderSignedOut()
    let resolveLogin: (() => void) | undefined
    mocked(loginWithGoogle).mockReturnValue(new Promise((resolve) => (resolveLogin = () => resolve({ status: 'ok' }))))

    act(() => {
      void result.current.signInWithGoogle('id-token')
    })
    expect(result.current.pending).toBe(true)

    await act(async () => resolveLogin?.())
    await waitFor(() => expect(result.current.pending).toBe(false))
  })

  it('opens the app, unverified, when /auth/google worked but the profile lookup failed, with no error text', async () => {
    const { result } = await renderSignedOut()
    mocked(getMe).mockRejectedValue(new SyncNetworkError())

    let outcome: boolean | undefined
    await act(async () => {
      outcome = await result.current.signInWithGoogle('id-token')
    })

    expect(outcome).toBe(true)
    expect(result.current.state).toBe('signedIn')
    expect(result.current.unverified).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it.each([
    ['a non-allowlisted account (403)', new SyncAuthError(403, null), "This Google account isn't allowed to use this Logbook."],
    ['a rejected token (401)', new SyncAuthError(401, null), 'Sign-in expired. Try again.'],
    ['an unreachable server', new SyncNetworkError(), "Couldn't reach the Logbook server. Check your connection and try again."],
    ['a server error (500)', new SyncHttpError(500, null, 'boom'), 'The Logbook server had a problem. Try again in a moment.'],
    ['a client error (400)', new SyncHttpError(400, null, 'bad'), "Sign-in didn't go through. Try again."],
    ['an unknown failure', new Error('weird'), 'Something went wrong. Try again.'],
  ])('stays signed out with a plain message for %s', async (_label, failure, message) => {
    const { result } = await renderSignedOut()
    mocked(loginWithGoogle).mockRejectedValue(failure)

    let outcome: boolean | undefined
    await act(async () => {
      outcome = await result.current.signInWithGoogle('id-token')
    })

    expect(outcome).toBe(false)
    expect(result.current.state).toBe('signedOut')
    expect(result.current.error).toBe(message)
  })

  it('clearError dismisses the message', async () => {
    const { result } = await renderSignedOut()
    mocked(loginWithGoogle).mockRejectedValue(new SyncNetworkError())
    await act(async () => {
      await result.current.signInWithGoogle('id-token')
    })

    act(() => result.current.clearError())

    expect(result.current.error).toBeNull()
  })

  it('wins over a slow startup check that resolves afterwards', async () => {
    let resolveMe: ((profile: AuthProfile) => void) | undefined
    mocked(getMe).mockReturnValueOnce(new Promise((resolve) => (resolveMe = resolve)))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(getMe).toHaveBeenCalled())
    mocked(getMe).mockResolvedValue(grace)

    await act(async () => {
      await result.current.signInWithGoogle('id-token')
    })
    mocked(putCachedIdentity).mockClear()
    await act(async () => resolveMe?.(ada))

    expect(result.current.profile).toEqual(grace)
    expect(putCachedIdentity).not.toHaveBeenCalled()
  })

  it('clears a pending "sign in again" prompt on success', async () => {
    const { result } = await renderSignedIn()
    act(() => result.current.noteAuthRequired())
    expect(result.current.needsSignIn).toBe(true)

    await act(async () => {
      await result.current.signInWithGoogle('id-token')
    })

    expect(result.current.needsSignIn).toBe(false)
  })
})

describe('useAuth: switching accounts', () => {
  async function renderPendingSwitch(options?: UseAuthOptions) {
    mocked(checkLocalOwner).mockResolvedValue('mismatch')
    const hook = renderHook(() => useAuth(options))
    await waitFor(() => expect(hook.result.current.pendingSwitch).toEqual(ada))
    return hook
  }

  it('does not open, drain or cache when a different account signs in', async () => {
    mocked(getMe).mockRejectedValueOnce(new SyncAuthError(401, null))
    mocked(checkLocalOwner).mockResolvedValue('mismatch')
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.state).toBe('signedOut'))
    mocked(getMe).mockResolvedValue(ada)

    await act(async () => {
      await result.current.signInWithGoogle('id-token')
    })

    expect(result.current.pendingSwitch).toEqual(ada)
    expect(result.current.state).toBe('signedOut')
    expect(drainOutbox).not.toHaveBeenCalled()
    expect(putCachedIdentity).not.toHaveBeenCalled()
  })

  it('confirming removes the old data, reloads dependents, signs in and drains', async () => {
    const onLocalDataReset = jest.fn()
    const { result } = await renderPendingSwitch({ onLocalDataReset })

    await act(async () => {
      await result.current.confirmSwitch()
    })

    expect(claimLocalData).toHaveBeenCalledWith('u1')
    expect(onLocalDataReset).toHaveBeenCalled()
    expect(result.current.state).toBe('signedIn')
    expect(result.current.profile).toEqual(ada)
    expect(result.current.pendingSwitch).toBeNull()
    expect(drainOutbox).toHaveBeenCalled()
  })

  it('confirming works without an onLocalDataReset callback', async () => {
    const { result } = await renderPendingSwitch()
    await act(async () => {
      await result.current.confirmSwitch()
    })
    expect(result.current.state).toBe('signedIn')
  })

  it('reports a failure to clear the old data and stays at the gate', async () => {
    const { result } = await renderPendingSwitch()
    mocked(claimLocalData).mockRejectedValue(new Error('boom'))

    await act(async () => {
      await result.current.confirmSwitch()
    })

    expect(result.current.state).toBe('signedOut')
    expect(result.current.error).toMatch(/Couldn't remove/)
  })

  it('confirming with nothing pending does nothing', async () => {
    const { result } = await renderSignedIn()
    await act(async () => {
      await result.current.confirmSwitch()
    })
    expect(claimLocalData).not.toHaveBeenCalled()
  })

  it('cancelling signs the new account back out and keeps the old data', async () => {
    const { result } = await renderPendingSwitch()

    await act(async () => {
      await result.current.cancelSwitch()
    })

    expect(logout).toHaveBeenCalled()
    expect(claimLocalData).not.toHaveBeenCalled()
    expect(result.current.pendingSwitch).toBeNull()
    expect(result.current.state).toBe('signedOut')
    expect(drainOutbox).not.toHaveBeenCalled()
  })
})

describe('useAuth: logout', () => {
  it('flushes the outbox, records the marker, forgets the identity and signs out on the server', async () => {
    const { result } = await renderSignedIn()

    await act(async () => {
      await result.current.logout()
    })

    expect(drainOutbox).toHaveBeenCalled()
    expect(setPendingLogout).toHaveBeenCalled()
    expect(clearCachedIdentity).toHaveBeenCalled()
    expect(logout).toHaveBeenCalled()
    expect(clearPendingLogout).toHaveBeenCalled()
    expect(disableGoogleAutoSelect).toHaveBeenCalled()
    expect(result.current.state).toBe('signedOut')
    expect(result.current.profile).toBeNull()
  })

  it('signs out locally and keeps the marker when offline', async () => {
    const { result } = await renderSignedIn()
    mocked(logout).mockRejectedValue(new SyncNetworkError())
    mocked(clearPendingLogout).mockClear()

    await act(async () => {
      await result.current.logout()
    })

    expect(result.current.state).toBe('signedOut')
    expect(result.current.pending).toBe(false)
    expect(clearPendingLogout).not.toHaveBeenCalled()
  })

  it('does not try to flush the outbox when the session is known to be gone', async () => {
    const { result } = await renderSignedIn()
    act(() => result.current.noteAuthRequired())
    mocked(drainOutbox).mockClear()

    await act(async () => {
      await result.current.logout()
    })

    expect(drainOutbox).not.toHaveBeenCalled()
    expect(result.current.needsSignIn).toBe(false)
  })

  it('still signs out when a step throws', async () => {
    const { result } = await renderSignedIn()
    mocked(setPendingLogout).mockRejectedValue(new Error('boom'))

    await act(async () => {
      await result.current.logout()
    })

    expect(result.current.state).toBe('signedOut')
  })

  it('wins over a slow startup check: it cannot sign the user back in or re-cache them', async () => {
    let resolveMe: ((profile: AuthProfile) => void) | undefined
    mocked(getMe).mockReturnValue(new Promise((resolve) => (resolveMe = resolve)))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(getMe).toHaveBeenCalled())

    await act(async () => {
      await result.current.logout()
    })
    mocked(putCachedIdentity).mockClear()
    await act(async () => resolveMe?.(ada))

    expect(result.current.state).toBe('signedOut')
    expect(putCachedIdentity).not.toHaveBeenCalled()
  })
})

describe('useAuth: noteAuthRequired', () => {
  it('raises needsSignIn without leaving the app (a background 401 must not unmount a capture in progress)', async () => {
    const { result } = await renderSignedIn()

    act(() => result.current.noteAuthRequired())

    expect(result.current.needsSignIn).toBe(true)
    expect(result.current.state).toBe('signedIn')
    expect(clearCachedIdentity).not.toHaveBeenCalled()
  })
})

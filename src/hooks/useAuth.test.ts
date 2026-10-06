import { act, renderHook, waitFor } from '@testing-library/react'
import { useAuth, type UseAuthOptions } from './useAuth.ts'
import {
  AUTH_MODE_PAUSE,
  LOCAL_PROBE_TIMEOUT_MS,
  RESTORE_TIMEOUT_MS,
  SIGNED_OUT_PAUSE,
  STARTUP_VERIFY_PAUSE,
} from '../lib/auth/sessionFlows.ts'
import { onBackOnline } from '../lib/sync/connectivity.ts'
import type { AuthConfig } from '../lib/auth/authConfig.ts'
import { getAuthConfig, getMe, loginWithGoogle, logout } from '../lib/sync/authApi.ts'
import { disableGoogleAutoSelect } from '../lib/auth/googleIdentity.ts'
import {
  clearCachedIdentity,
  clearPendingLogout,
  getCachedAuthConfig,
  getCachedIdentity,
  hasPendingLogout,
  putCachedAuthConfig,
  putCachedIdentity,
  setPendingLogout,
} from '../lib/db/identityStore.ts'
import { checkLocalOwner, claimLocalData, hasLocalData } from '../lib/db/localOwner.ts'
import { drainOutbox, pauseDrains, resumeDrains } from '../lib/sync/outboxRunner.ts'
import { SyncAuthError, SyncHttpError, SyncNetworkError } from '../lib/sync/errors.ts'
import type { AuthProfile } from '../types/auth.ts'

jest.mock('../lib/sync/authApi.ts')
jest.mock('../lib/auth/googleIdentity.ts', () => ({ disableGoogleAutoSelect: jest.fn() }))
jest.mock('../lib/db/identityStore.ts')
jest.mock('../lib/db/localOwner.ts')
jest.mock('../lib/sync/outboxRunner.ts')
jest.mock('../lib/sync/connectivity.ts')

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.Mock

const ada: AuthProfile = { id: 'u1', email: 'ada@example.com', name: 'Ada', picture: null }
const grace: AuthProfile = { id: 'u2', email: 'grace@example.com', name: 'Grace', picture: null }

const googleConfig: AuthConfig = { methods: [{ type: 'google', clientId: 'cid.apps.googleusercontent.com' }] }
const noLogin: AuthConfig = { methods: [] }

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
  mocked(getAuthConfig).mockResolvedValue(googleConfig)
  mocked(getCachedAuthConfig).mockResolvedValue(null)
  mocked(putCachedAuthConfig).mockResolvedValue(undefined)
  mocked(pauseDrains).mockResolvedValue(undefined)
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

  describe('a startup that is taking too long', () => {
    beforeEach(() => jest.useFakeTimers())

    async function advance(ms: number) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(ms)
      })
    }

    it('opens unverified after the timeout for an existing user (local entries), instead of the splash forever', async () => {
      mocked(getMe).mockReturnValue(new Promise(() => undefined))
      mocked(hasLocalData).mockResolvedValue(true)
      const { result } = renderHook(() => useAuth())
      expect(result.current.state).toBe('loading')

      await advance(0) // the auth config resolves first; the getMe timeout starts after it
      await advance(RESTORE_TIMEOUT_MS)

      expect(result.current.state).toBe('signedIn')
      expect(result.current.unverified).toBe(true)
    })

    it('keeps a first-time user (nothing local) on the splash until the server answers', async () => {
      let resolveMe: ((profile: AuthProfile) => void) | undefined
      mocked(getMe).mockReturnValue(new Promise((resolve) => (resolveMe = resolve)))
      mocked(hasLocalData).mockResolvedValue(false)
      const { result } = renderHook(() => useAuth())

      await advance(RESTORE_TIMEOUT_MS + LOCAL_PROBE_TIMEOUT_MS)
      expect(result.current.state).toBe('loading')

      await act(async () => resolveMe?.(ada))
      expect(result.current.state).toBe('signedIn')
      expect(result.current.unverified).toBe(false)
    })

    it('falls through to the gate when IndexedDB itself is what is stuck', async () => {
      mocked(hasPendingLogout).mockReturnValue(new Promise(() => undefined))
      mocked(hasLocalData).mockReturnValue(new Promise(() => undefined))
      const { result } = renderHook(() => useAuth())

      await advance(0)
      await advance(RESTORE_TIMEOUT_MS + LOCAL_PROBE_TIMEOUT_MS)

      expect(result.current.state).toBe('signedOut')
    })

    it('does not apply the timeout fallback once startup has resolved', async () => {
      const { result } = renderHook(() => useAuth())
      await advance(10)
      expect(result.current.profile).toEqual(ada)

      await advance(RESTORE_TIMEOUT_MS + LOCAL_PROBE_TIMEOUT_MS)

      expect(result.current.unverified).toBe(false)
    })

    it('does not let a late fallback overwrite a session that arrived in the meantime', async () => {
      let resolveLocal: ((has: boolean) => void) | undefined
      mocked(getMe).mockReturnValue(new Promise(() => undefined))
      mocked(hasLocalData).mockReturnValue(new Promise((resolve) => (resolveLocal = resolve)))
      mocked(getCachedIdentity).mockResolvedValue(grace)
      const { result } = renderHook(() => useAuth())
      await advance(RESTORE_TIMEOUT_MS)

      await act(async () => resolveLocal?.(true))

      expect(result.current.profile).toEqual(grace)
    })

    it('shows the gate, not an open app, when startup itself throws and there is no local data', async () => {
      mocked(hasPendingLogout).mockRejectedValue(new Error('boom'))
      const { result } = renderHook(() => useAuth())
      await advance(0)
      expect(result.current.state).toBe('signedOut')
    })

    it('opens unverified when startup itself throws but there is local data', async () => {
      mocked(hasPendingLogout).mockRejectedValue(new Error('boom'))
      mocked(hasLocalData).mockResolvedValue(true)
      const { result } = renderHook(() => useAuth())
      await advance(0)
      expect(result.current.state).toBe('signedIn')
      expect(result.current.unverified).toBe(true)
    })
  })
})

describe('useAuth: verifying an unverified session', () => {
  async function renderUnverified() {
    mocked(getCachedIdentity).mockResolvedValue(grace)
    mocked(getMe).mockRejectedValue(new SyncNetworkError())
    const hook = renderHook(() => useAuth())
    await waitFor(() => expect(hook.result.current.unverified).toBe(true))
    await waitFor(() => expect(onlineListeners).toHaveLength(1))
    return hook
  }

  it('confirms the profile when connectivity returns and the server answers', async () => {
    const { result } = await renderUnverified()
    mocked(getMe).mockResolvedValue(grace)

    goOnline()

    await waitFor(() => expect(result.current.unverified).toBe(false))
    expect(result.current.profile).toEqual(grace)
  })

  it('also retries on its own backoff timer, with no online event and no drain (drains are held back)', async () => {
    jest.useFakeTimers()
    mocked(getCachedIdentity).mockResolvedValue(grace)
    mocked(getMe).mockRejectedValue(new SyncNetworkError())
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
    })
    expect(result.current.unverified).toBe(true)
    mocked(getMe).mockResolvedValue(grace)

    await act(async () => {
      await jest.advanceTimersByTimeAsync(15_000)
    })

    expect(result.current.unverified).toBe(false)
  })

  it('asks the user to sign in again, without a gate, when the server says 401', async () => {
    const { result } = await renderUnverified()
    mocked(getMe).mockRejectedValue(new SyncAuthError(401, null))

    goOnline()

    await waitFor(() => expect(result.current.needsSignIn).toBe(true))
    expect(result.current.state).toBe('signedIn')
  })

  it('shows the full gate when a never-verified session (no cached identity) turns out to be a 401', async () => {
    mocked(getMe).mockRejectedValue(new SyncNetworkError())
    mocked(hasLocalData).mockResolvedValue(true)
    const hook = renderHook(() => useAuth())
    await waitFor(() => expect(hook.result.current.unverified).toBe(true))
    await waitFor(() => expect(onlineListeners).toHaveLength(1))
    mocked(getMe).mockRejectedValue(new SyncAuthError(401, null))

    goOnline()

    await waitFor(() => expect(hook.result.current.state).toBe('signedOut'))
  })

  it('keeps a never-verified session open on a 5xx from /auth/me (that is not a verdict)', async () => {
    mocked(getMe).mockRejectedValue(new SyncNetworkError())
    mocked(hasLocalData).mockResolvedValue(true)
    const hook = renderHook(() => useAuth())
    await waitFor(() => expect(hook.result.current.unverified).toBe(true))
    await waitFor(() => expect(onlineListeners).toHaveLength(1))
    mocked(getMe).mockRejectedValue(new SyncHttpError(503, null, 'down'))

    goOnline()
    await act(async () => {})

    expect(hook.result.current.state).toBe('signedIn')
    expect(hook.result.current.unverified).toBe(true)
    expect(hook.result.current.needsSignIn).toBe(false)
  })

  it('stays unverified, still retrying, if the server still cannot be reached', async () => {
    const { result } = await renderUnverified()

    goOnline()
    await act(async () => {})

    expect(result.current.unverified).toBe(true)
    expect(result.current.needsSignIn).toBe(false)
    expect(onlineListeners).toHaveLength(1)
  })

  it('drops a verification result that a sign-out has superseded', async () => {
    const { result } = await renderUnverified()
    let resolveMe: ((profile: AuthProfile) => void) | undefined
    mocked(getMe).mockReturnValue(new Promise((resolve) => (resolveMe = resolve)))
    goOnline()

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
    mocked(drainOutbox).mockClear() // the drain on entering google mode is not under test

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
    mocked(drainOutbox).mockClear() // the drain on entering google mode is not under test

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

  it('leaves no error text behind when a sign-out step fails (an empty string would hide the status line)', async () => {
    const { result } = await renderSignedIn()
    mocked(setPendingLogout).mockRejectedValue(new Error('boom'))

    await act(async () => {
      await result.current.logout()
    })

    expect(result.current.error).toBeNull()
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
  it('raises needsSignIn on a 401 without leaving the app (a background 401 must not unmount a capture in progress)', async () => {
    const { result } = await renderSignedIn()

    act(() => result.current.noteAuthRequired(401))

    expect(result.current.needsSignIn).toBe(true)
    expect(result.current.state).toBe('signedIn')
    expect(clearCachedIdentity).not.toHaveBeenCalled()
  })

  it('treats a report with no status like a 401', async () => {
    const { result } = await renderSignedIn()
    act(() => result.current.noteAuthRequired())
    expect(result.current.needsSignIn).toBe(true)
  })

  it('ignores it once signed out: there is nothing to sign in again to', async () => {
    const { result } = await renderSignedIn()
    await act(async () => {
      await result.current.logout()
    })

    act(() => result.current.noteAuthRequired(401))

    expect(result.current.needsSignIn).toBe(false)
  })

  it('lets the user dismiss the prompt, and shows it again on the next 401', async () => {
    const { result } = await renderSignedIn()
    act(() => result.current.noteAuthRequired(401))

    act(() => result.current.dismissSignInPrompt())
    expect(result.current.needsSignIn).toBe(false)

    act(() => result.current.noteAuthRequired(401))
    expect(result.current.needsSignIn).toBe(true)
  })

  describe('a 403 (a refusal, not an expired session)', () => {
    it('never raises the sign-in prompt; it re-syncs the cookies with /auth/me and retries the drain once', async () => {
      const { result } = await renderSignedIn()
      mocked(getMe).mockClear()
      mocked(drainOutbox).mockClear()

      await act(async () => result.current.noteAuthRequired(403))

      expect(getMe).toHaveBeenCalledTimes(1)
      expect(drainOutbox).toHaveBeenCalledTimes(1)
      expect(result.current.needsSignIn).toBe(false)
    })

    it('heals only once: a refusal that persists is left to the sync status line, not looped on', async () => {
      const { result } = await renderSignedIn()
      mocked(drainOutbox).mockResolvedValue({ processed: 0, stoppedReason: 'auth', authStatus: 403 })
      await act(async () => result.current.noteAuthRequired(403))
      mocked(getMe).mockClear()
      mocked(drainOutbox).mockClear()

      await act(async () => result.current.noteAuthRequired(403))

      expect(getMe).not.toHaveBeenCalled()
      expect(drainOutbox).not.toHaveBeenCalled()
      expect(result.current.needsSignIn).toBe(false)
    })

    it('does not start a second heal while one is running', async () => {
      const { result } = await renderSignedIn()
      let finish: (() => void) | undefined
      mocked(getMe).mockClear()
      mocked(getMe).mockReturnValue(new Promise((resolve) => (finish = () => resolve(ada))))

      act(() => result.current.noteAuthRequired(403))
      act(() => result.current.noteAuthRequired(403))
      expect(getMe).toHaveBeenCalledTimes(1)

      await act(async () => finish?.())
    })

    it('allows a new heal later, once the failed one has had time to pass', async () => {
      jest.useFakeTimers()
      const { result } = renderHook(() => useAuth())
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0)
      })
      mocked(drainOutbox).mockResolvedValue({ processed: 0, stoppedReason: 'auth', authStatus: 403 })
      await act(async () => result.current.noteAuthRequired(403))
      mocked(getMe).mockClear()

      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_000)
      })
      await act(async () => result.current.noteAuthRequired(403))

      expect(getMe).toHaveBeenCalledTimes(1)
    })

    it('raises the prompt if /auth/me shows the session really is gone (401)', async () => {
      const { result } = await renderSignedIn()
      mocked(getMe).mockRejectedValue(new SyncAuthError(401, null))

      await act(async () => result.current.noteAuthRequired(403))

      expect(result.current.needsSignIn).toBe(true)
    })

    it('treats a network failure during the heal as a failed heal, with no prompt', async () => {
      const { result } = await renderSignedIn()
      mocked(getMe).mockRejectedValue(new SyncNetworkError())

      await act(async () => result.current.noteAuthRequired(403))

      expect(result.current.needsSignIn).toBe(false)
    })

    it('is ignored while signed out', async () => {
      const { result } = await renderSignedIn()
      await act(async () => {
        await result.current.logout()
      })
      mocked(getMe).mockClear()

      await act(async () => result.current.noteAuthRequired(403))

      expect(getMe).not.toHaveBeenCalled()
    })
  })
})

describe('useAuth: the server decides which login (GET /auth/config)', () => {
  it('stays "loading" until the config is known', async () => {
    mocked(getAuthConfig).mockReturnValue(new Promise(() => undefined))
    const { result } = renderHook(() => useAuth())
    expect(result.current.mode).toBe('loading')
    expect(result.current.state).toBe('loading')
    await act(async () => {})
  })

  it('exposes the mode and the client ID the server gave', async () => {
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.mode).toBe('google'))
    expect(result.current.googleClientId).toBe('cid.apps.googleusercontent.com')
    await waitFor(() => expect(result.current.state).toBe('signedIn'))
  })

  describe('when the server has login off ("none": local-only)', () => {
    beforeEach(() => mocked(getAuthConfig).mockResolvedValue(noLogin))

    it('opens the app straight away: no gate, no getMe, no cached identity or owner logic', async () => {
      const { result } = renderHook(() => useAuth())

      await waitFor(() => expect(result.current.mode).toBe('none'))
      expect(result.current).toMatchObject({ state: 'signedIn', profile: null, unverified: false, needsSignIn: false })
      expect(getMe).not.toHaveBeenCalled()
      expect(getCachedIdentity).not.toHaveBeenCalled()
      expect(hasPendingLogout).not.toHaveBeenCalled()
      expect(checkLocalOwner).not.toHaveBeenCalled()
    })

    it('holds every drain back (no 401 churn) under its own pause reason, and never starts one', async () => {
      const { result } = renderHook(() => useAuth())
      await waitFor(() => expect(result.current.mode).toBe('none'))

      expect(pauseDrains).toHaveBeenCalledWith(AUTH_MODE_PAUSE)
      expect(drainOutbox).not.toHaveBeenCalled()
    })

    it('lifts a leftover signed-out hold, since there is no login to sign back in to', async () => {
      const { result } = renderHook(() => useAuth())
      await waitFor(() => expect(result.current.mode).toBe('none'))
      expect(resumeDrains).toHaveBeenCalledWith(SIGNED_OUT_PAUSE)
    })

    it('ignores a background 401: there is nothing to sign in to', async () => {
      const { result } = renderHook(() => useAuth())
      await waitFor(() => expect(result.current.mode).toBe('none'))

      act(() => result.current.noteAuthRequired())

      expect(result.current.needsSignIn).toBe(false)
    })

    it('releases its pause on unmount', async () => {
      const { result, unmount } = renderHook(() => useAuth())
      await waitFor(() => expect(result.current.mode).toBe('none'))

      unmount()

      expect(resumeDrains).toHaveBeenCalledWith(AUTH_MODE_PAUSE)
    })

    it('treats a cached identity as local-only and leaves its data untouched', async () => {
      mocked(getCachedIdentity).mockResolvedValue(grace)
      const { result } = renderHook(() => useAuth())

      await waitFor(() => expect(result.current.mode).toBe('none'))

      expect(result.current.state).toBe('signedIn')
      expect(clearCachedIdentity).not.toHaveBeenCalled()
      expect(claimLocalData).not.toHaveBeenCalled()
    })
  })

  describe('when the server wants Google ("google")', () => {
    it('holds drains back from the very start, and releases them only after /auth/me AND the owner check', async () => {
      const order: string[] = []
      mocked(pauseDrains).mockImplementation(async (reason: string) => void order.push(`pause:${reason}`))
      mocked(resumeDrains).mockImplementation((reason: string) => void order.push(`resume:${reason}`))
      mocked(drainOutbox).mockImplementation(async () => {
        order.push('drain')
        return { processed: 0, stoppedReason: 'empty' }
      })
      mocked(checkLocalOwner).mockImplementation(async () => {
        order.push('owner-check')
        return 'ok'
      })

      const { result } = renderHook(() => useAuth())
      await waitFor(() => expect(result.current.profile).toEqual(ada))
      await waitFor(() => expect(order).toContain('drain'))

      expect(order[0]).toBe('pause:' + AUTH_MODE_PAUSE)
      expect(order.indexOf('pause:' + STARTUP_VERIFY_PAUSE)).toBeLessThan(order.indexOf('resume:' + AUTH_MODE_PAUSE))
      expect(order.indexOf('owner-check')).toBeLessThan(order.indexOf('resume:' + STARTUP_VERIFY_PAUSE))
      expect(order.indexOf('resume:' + STARTUP_VERIFY_PAUSE)).toBeLessThan(order.indexOf('drain'))
    })

    it('does not drain, nor release the startup pause, while /auth/me cannot be reached', async () => {
      mocked(getCachedIdentity).mockResolvedValue(grace)
      mocked(getMe).mockRejectedValue(new SyncNetworkError())
      const { result } = renderHook(() => useAuth())
      await waitFor(() => expect(result.current.unverified).toBe(true))
      await act(async () => {})

      expect(pauseDrains).toHaveBeenCalledWith(STARTUP_VERIFY_PAUSE)
      expect(resumeDrains).not.toHaveBeenCalledWith(STARTUP_VERIFY_PAUSE)
      expect(drainOutbox).not.toHaveBeenCalled()
    })

    it('keeps drains paused for a different account (pending switch)', async () => {
      mocked(checkLocalOwner).mockResolvedValue('mismatch')
      const { result } = renderHook(() => useAuth())
      await waitFor(() => expect(result.current.pendingSwitch).toEqual(ada))
      await act(async () => {})

      expect(resumeDrains).not.toHaveBeenCalledWith(STARTUP_VERIFY_PAUSE)
      expect(drainOutbox).not.toHaveBeenCalled()
    })

    it('releases them once a later verification succeeds', async () => {
      mocked(getCachedIdentity).mockResolvedValue(grace)
      mocked(getMe).mockRejectedValue(new SyncNetworkError())
      const { result } = renderHook(() => useAuth())
      await waitFor(() => expect(result.current.unverified).toBe(true))
      await waitFor(() => expect(onlineListeners).toHaveLength(1))
      mocked(getMe).mockResolvedValue(grace)

      goOnline()

      await waitFor(() => expect(resumeDrains).toHaveBeenCalledWith(STARTUP_VERIFY_PAUSE))
      await waitFor(() => expect(drainOutbox).toHaveBeenCalled())
    })

    it('holds drains again after signing out, and lifts the hold when mode goes local-only', async () => {
      const { result } = await renderSignedIn()
      mocked(pauseDrains).mockClear()

      await act(async () => {
        await result.current.logout()
      })

      expect(pauseDrains).toHaveBeenCalledWith(STARTUP_VERIFY_PAUSE)
    })

    it('shows the gate with no known identity (the existing rules apply)', async () => {
      mocked(getMe).mockRejectedValue(new SyncAuthError(401, null))
      const { result } = renderHook(() => useAuth())
      await waitFor(() => expect(result.current.state).toBe('signedOut'))
      expect(result.current.mode).toBe('google')
    })

    it('opens from a cached config offline: the gate rules still apply with the cached client ID', async () => {
      mocked(getCachedAuthConfig).mockResolvedValue(googleConfig)
      mocked(getAuthConfig).mockResolvedValue(null)
      mocked(getCachedIdentity).mockResolvedValue(grace)
      mocked(getMe).mockRejectedValue(new SyncNetworkError())
      const { result } = renderHook(() => useAuth())

      await waitFor(() => expect(result.current.profile).toEqual(grace))
      expect(result.current.mode).toBe('google')
      expect(result.current.unverified).toBe(true)
    })

    it('counts a background 401 as "sign in again" (the banner)', async () => {
      const { result } = await renderSignedIn()
      act(() => result.current.noteAuthRequired(401))
      expect(result.current.needsSignIn).toBe(true)
    })
  })

  describe('when the server cannot be asked and nothing is cached ("unknown")', () => {
    beforeEach(() => mocked(getAuthConfig).mockResolvedValue(null))

    it('opens local-only instead of trapping an offline user: no gate, no getMe, no drains', async () => {
      const { result } = renderHook(() => useAuth())

      await waitFor(() => expect(result.current.mode).toBe('unknown'))

      expect(result.current).toMatchObject({ state: 'signedIn', profile: null, needsSignIn: false })
      expect(getMe).not.toHaveBeenCalled()
      expect(pauseDrains).toHaveBeenCalledWith(AUTH_MODE_PAUSE)
      expect(resumeDrains).not.toHaveBeenCalledWith(SIGNED_OUT_PAUSE)
    })

    it('switches to the gate when the server later says Google, as for any never-verified session', async () => {
      const { result } = renderHook(() => useAuth())
      await waitFor(() => expect(result.current.mode).toBe('unknown'))
      mocked(getAuthConfig).mockResolvedValue(googleConfig)
      mocked(getMe).mockRejectedValue(new SyncAuthError(401, null))

      act(() => onlineListeners.forEach((listener) => listener()))

      await waitFor(() => expect(result.current.state).toBe('signedOut'))
      expect(result.current.mode).toBe('google')
    })

    it('stays open and local-only when the server later says login is off', async () => {
      const { result } = renderHook(() => useAuth())
      await waitFor(() => expect(result.current.mode).toBe('unknown'))
      mocked(getAuthConfig).mockResolvedValue(noLogin)

      act(() => onlineListeners.forEach((listener) => listener()))

      await waitFor(() => expect(result.current.mode).toBe('none'))
      expect(result.current.state).toBe('signedIn')
    })

    it('opens the app, verified, once Google is on and the browser already has a session', async () => {
      const { result } = renderHook(() => useAuth())
      await waitFor(() => expect(result.current.mode).toBe('unknown'))
      mocked(getAuthConfig).mockResolvedValue(googleConfig)

      act(() => onlineListeners.forEach((listener) => listener()))

      await waitFor(() => expect(result.current.profile).toEqual(ada))
      expect(result.current.unverified).toBe(false)
    })
  })

  it('goes local-only, keeping everything, when a cached "google" is replaced by a fresh "none" while signed in', async () => {
    mocked(getCachedAuthConfig).mockResolvedValue(googleConfig)
    mocked(getAuthConfig).mockResolvedValue(noLogin)
    mocked(getCachedIdentity).mockResolvedValue(grace)
    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(result.current.mode).toBe('none'))

    expect(result.current).toMatchObject({ state: 'signedIn', needsSignIn: false })
    expect(clearCachedIdentity).not.toHaveBeenCalled()
  })

  it('under dev:mocked skips the server entirely (sample data, no backend)', () => {
    ;(globalThis as { __LOGBOOK_MOCKED__?: boolean }).__LOGBOOK_MOCKED__ = true
    const { result } = renderHook(() => useAuth())
    expect(result.current).toMatchObject({ mode: 'mock', state: 'signedIn', unverified: false })
    expect(getAuthConfig).not.toHaveBeenCalled()
    expect(pauseDrains).not.toHaveBeenCalled()
  })

  it('explains a 404 from /auth/google (the server turned Google off meanwhile)', async () => {
    const { result } = await renderSignedOut()
    mocked(loginWithGoogle).mockRejectedValue(new SyncHttpError(404, null, 'Not Found'))

    await act(async () => {
      await result.current.signInWithGoogle('id-token')
    })

    expect(result.current.error).toBe('Google sign-in is turned off on this server.')
  })
})

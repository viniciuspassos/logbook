import { act, renderHook, waitFor } from '@testing-library/react'
import { useAuth, type UseAuthOptions } from './useAuth.ts'
import {
  ACCOUNT_CHANGED_NOTICE,
  SIGN_OUT_NEEDS_CONNECTION,
  SIGN_OUT_NEEDS_SIGN_IN,
  STARTUP_TIMEOUT_MS,
} from '../lib/auth/sessionFlows.ts'
import { onBackOnline } from '../lib/sync/connectivity.ts'
import type { AuthConfig } from '../lib/auth/authConfig.ts'
import { getAuthConfig, getMe, loginWithGoogle, logout } from '../lib/sync/authApi.ts'
import {
  clearCachedIdentity,
  getCachedAuthConfig,
  getCachedIdentity,
  putCachedAuthConfig,
  putCachedIdentity,
} from '../lib/db/identityStore.ts'
import { clearLocalData, hasLocalData } from '../lib/db/localData.ts'
import { drainOutbox, setDrainsAllowed } from '../lib/sync/outboxRunner.ts'
import { SyncAuthError, SyncHttpError, SyncNetworkError } from '../lib/sync/errors.ts'
import type { AuthProfile } from '../types/auth.ts'

jest.mock('../lib/sync/authApi.ts')
jest.mock('../lib/auth/googleIdentity.ts', () => ({ disableGoogleAutoSelect: jest.fn() }))
jest.mock('../lib/db/identityStore.ts')
jest.mock('../lib/db/localData.ts')
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
  mocked(getCachedIdentity).mockResolvedValue(null)
  mocked(getMe).mockResolvedValue(ada)
  mocked(loginWithGoogle).mockResolvedValue({ status: 'ok' })
  mocked(logout).mockResolvedValue({ status: 'ok' })
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
    expect(result.current.profile).toBeNull()

    await waitFor(() => expect(result.current.state).toBe('signedIn'))
    expect(result.current.profile).toEqual(ada)
    expect(result.current.unverified).toBe(false)
    expect(putCachedIdentity).toHaveBeenCalledWith(ada)
  })

  it('shows the gate on a 401 with nothing cached', async () => {
    const { result } = await renderSignedOut()
    expect(result.current.profile).toBeNull()
  })

  it('opens from the cached identity without waiting on the network, as unverified', async () => {
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

  it('wipes this device and says so when the server session is a different account than the cached identity', async () => {
    mocked(getCachedIdentity).mockResolvedValue(ada)
    mocked(getMe).mockResolvedValue(grace)
    const onLocalDataReset = jest.fn()
    const { result } = renderHook(() => useAuth({ onLocalDataReset }))

    await waitFor(() => expect(result.current.notice).toBe(ACCOUNT_CHANGED_NOTICE))

    expect(clearLocalData).toHaveBeenCalledTimes(1)
    expect(onLocalDataReset).toHaveBeenCalledTimes(1)
    expect(result.current.profile).toEqual(grace)
    expect(result.current.unverified).toBe(false)
  })

  it('lets the user dismiss that notice', async () => {
    mocked(getCachedIdentity).mockResolvedValue(ada)
    mocked(getMe).mockResolvedValue(grace)
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.notice).toBe(ACCOUNT_CHANGED_NOTICE))

    act(() => result.current.dismissNotice())

    expect(result.current.notice).toBeNull()
    expect(result.current.profile).toEqual(grace)
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

    it('opens a known device (local entries) unverified after the timeout, instead of the splash forever', async () => {
      mocked(getMe).mockReturnValue(new Promise(() => undefined))
      mocked(hasLocalData).mockResolvedValue(true)
      const { result } = renderHook(() => useAuth())
      expect(result.current.state).toBe('loading')

      await advance(0) // the auth config resolves first; the getMe timeout starts after it
      await advance(STARTUP_TIMEOUT_MS)

      expect(result.current.state).toBe('signedIn')
      expect(result.current.unverified).toBe(true)
    })

    it('keeps a first-time device (nothing cached, nothing local) waiting for the server', async () => {
      let resolveMe: ((profile: AuthProfile) => void) | undefined
      mocked(getMe).mockReturnValue(new Promise((resolve) => (resolveMe = resolve)))
      const { result } = renderHook(() => useAuth())

      await advance(0)
      await advance(STARTUP_TIMEOUT_MS * 3)
      expect(result.current.state).toBe('loading')

      await act(async () => resolveMe?.(ada))
      expect(result.current.state).toBe('signedIn')
      expect(result.current.unverified).toBe(false)
    })

    it('does not apply the timeout fallback once startup has resolved', async () => {
      const { result } = renderHook(() => useAuth())
      await advance(10)
      expect(result.current.profile).toEqual(ada)

      await advance(STARTUP_TIMEOUT_MS * 2)

      expect(result.current.unverified).toBe(false)
    })

    it('does not let a late fallback overwrite a session that arrived in the meantime', async () => {
      let resolveLocal: ((has: boolean) => void) | undefined
      mocked(getMe).mockReturnValue(new Promise(() => undefined))
      mocked(hasLocalData).mockReturnValue(new Promise((resolve) => (resolveLocal = resolve)))
      mocked(getCachedIdentity).mockResolvedValueOnce(grace).mockResolvedValue(null)
      const { result } = renderHook(() => useAuth())
      await advance(0)
      await advance(STARTUP_TIMEOUT_MS)

      await act(async () => resolveLocal?.(true))

      expect(result.current.profile).toEqual(grace)
    })
  })
})

describe('useAuth: verifying an unverified session (when the app may be reachable again)', () => {
  async function renderUnverified() {
    mocked(getCachedIdentity).mockResolvedValue(grace)
    mocked(getMe).mockRejectedValue(new SyncNetworkError())
    const hook = renderHook(() => useAuth())
    await waitFor(() => expect(hook.result.current.unverified).toBe(true))
    await waitFor(() => expect(onlineListeners).toHaveLength(1))
    return hook
  }

  it('confirms the profile when connectivity (or focus) returns and the server answers', async () => {
    const { result } = await renderUnverified()
    mocked(getMe).mockResolvedValue(grace)

    goOnline()

    await waitFor(() => expect(result.current.unverified).toBe(false))
    expect(result.current.profile).toEqual(grace)
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

  it('stays unverified, still listening, if the server still cannot be reached', async () => {
    const { result } = await renderUnverified()

    goOnline()
    await act(async () => {})

    expect(result.current.unverified).toBe(true)
    expect(onlineListeners).toHaveLength(1)
  })

  it('does not run two verifications at once (online, focus and visible often fire together)', async () => {
    await renderUnverified()
    mocked(getMe).mockClear()
    mocked(getMe).mockReturnValue(new Promise(() => undefined))

    goOnline()
    goOnline()

    expect(getMe).toHaveBeenCalledTimes(1)
  })

  it('wipes and says so when verification finds a different account than the cached identity', async () => {
    const { result } = await renderUnverified()
    mocked(getMe).mockResolvedValue(ada)

    goOnline()

    await waitFor(() => expect(result.current.notice).toBe(ACCOUNT_CHANGED_NOTICE))
    expect(clearLocalData).toHaveBeenCalledTimes(1)
  })

  it('drops a verification result that a sign-in has superseded', async () => {
    const { result } = await renderUnverified()
    let resolveMe: ((profile: AuthProfile) => void) | undefined
    mocked(getMe).mockReturnValue(new Promise((resolve) => (resolveMe = resolve)))
    goOnline()
    mocked(getMe).mockResolvedValue(ada)

    await act(async () => {
      await result.current.signInWithGoogle('id-token')
    })
    await act(async () => resolveMe?.(grace))

    expect(result.current.profile).toEqual(ada)
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

  it('opens the app, unverified and without draining, when /auth/google worked but the profile lookup failed, with no error text', async () => {
    const { result } = await renderSignedOut()
    mocked(getMe).mockRejectedValue(new SyncNetworkError())
    mocked(drainOutbox).mockClear()

    let outcome: boolean | undefined
    await act(async () => {
      outcome = await result.current.signInWithGoogle('id-token')
    })

    expect(outcome).toBe(true)
    expect(result.current.state).toBe('signedIn')
    expect(result.current.unverified).toBe(true)
    expect(result.current.error).toBeNull()
    expect(drainOutbox).not.toHaveBeenCalled()
  })

  it.each([
    ['a non-allowlisted account (403)', new SyncAuthError(403, null), "This Google account isn't allowed to use this Logbook."],
    ['a rejected token (401)', new SyncAuthError(401, null), 'Sign-in expired. Try again.'],
    ['an unreachable server', new SyncNetworkError(), "Couldn't reach the Logbook server. Check your connection and try again."],
    ['a server error (500)', new SyncHttpError(500, null, 'boom'), 'The Logbook server had a problem. Try again in a moment.'],
    ['a client error (400)', new SyncHttpError(400, null, 'bad'), "Sign-in didn't go through. Try again."],
    ['a 404 (the server turned Google off meanwhile)', new SyncHttpError(404, null, 'Not Found'), 'Google sign-in is turned off on this server.'],
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

  it('wipes this device, tells the user and resets the in-memory list when a different account signs in', async () => {
    const onLocalDataReset = jest.fn()
    const { result } = await renderSignedOut({ onLocalDataReset })
    mocked(getCachedIdentity).mockResolvedValue(grace)

    await act(async () => {
      await result.current.signInWithGoogle('id-token')
    })

    expect(clearLocalData).toHaveBeenCalledTimes(1)
    expect(onLocalDataReset).toHaveBeenCalledTimes(1)
    expect(result.current.notice).toBe(ACCOUNT_CHANGED_NOTICE)
  })

  describe('the drain gate around a sign-in', () => {
    it('closes it for the duration, then reopens it once the session is verified', async () => {
      const { result } = await renderSignedIn()
      const calls: boolean[] = []
      mocked(setDrainsAllowed).mockImplementation((allowed: boolean) => void calls.push(allowed))

      await act(async () => {
        await result.current.signInWithGoogle('id-token')
      })

      expect(calls[0]).toBe(false)
      expect(calls.at(-1)).toBe(true)
    })

    it('puts it back as it was when /auth/google fails (verified before: open)', async () => {
      const { result } = await renderSignedIn()
      mocked(loginWithGoogle).mockRejectedValue(new SyncNetworkError())
      mocked(setDrainsAllowed).mockClear()

      await act(async () => {
        await result.current.signInWithGoogle('id-token')
      })

      expect(mocked(setDrainsAllowed).mock.calls.at(-1)).toEqual([true])
    })

    it('and keeps it closed when /auth/google fails at the gate', async () => {
      const { result } = await renderSignedOut()
      mocked(loginWithGoogle).mockRejectedValue(new SyncNetworkError())
      mocked(setDrainsAllowed).mockClear()

      await act(async () => {
        await result.current.signInWithGoogle('id-token')
      })

      expect(mocked(setDrainsAllowed).mock.calls.at(-1)).toEqual([false])
    })
  })
})

describe('useAuth: logout (needs a connection)', () => {
  it('syncs, signs out on the server, forgets the identity, wipes this device and returns to the gate', async () => {
    const onLocalDataReset = jest.fn()
    const { result } = await renderSignedIn({ onLocalDataReset })

    await act(async () => {
      await result.current.logout()
    })

    expect(drainOutbox).toHaveBeenCalled()
    expect(logout).toHaveBeenCalled()
    expect(clearCachedIdentity).toHaveBeenCalled()
    expect(clearLocalData).toHaveBeenCalled()
    expect(onLocalDataReset).toHaveBeenCalledTimes(1)
    expect(result.current.state).toBe('signedOut')
    expect(result.current.profile).toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.pending).toBe(false)
  })

  it('changes nothing and says to connect and sync first when the server cannot be reached', async () => {
    const onLocalDataReset = jest.fn()
    const { result } = await renderSignedIn({ onLocalDataReset })
    mocked(drainOutbox).mockResolvedValue({ processed: 0, stoppedReason: 'unreachable' })

    await act(async () => {
      await result.current.logout()
    })

    expect(result.current.error).toBe(SIGN_OUT_NEEDS_CONNECTION)
    expect(result.current.state).toBe('signedIn')
    expect(result.current.profile).toEqual(ada)
    expect(logout).not.toHaveBeenCalled()
    expect(clearLocalData).not.toHaveBeenCalled()
    expect(onLocalDataReset).not.toHaveBeenCalled()
  })

  it('says to sign in again when the session is already gone', async () => {
    const { result } = await renderSignedIn()
    mocked(drainOutbox).mockResolvedValue({ processed: 0, stoppedReason: 'auth' })

    await act(async () => {
      await result.current.logout()
    })

    expect(result.current.error).toBe(SIGN_OUT_NEEDS_SIGN_IN)
    expect(result.current.state).toBe('signedIn')
  })

  it('leaves an in-flight startup verification able to finish when the sign-out is refused', async () => {
    let resolveMe: ((profile: AuthProfile) => void) | undefined
    mocked(getCachedIdentity).mockResolvedValue(grace)
    mocked(getMe).mockReturnValue(new Promise((resolve) => (resolveMe = resolve)))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.unverified).toBe(true))
    mocked(drainOutbox).mockResolvedValue({ processed: 0, stoppedReason: 'aborted' })

    await act(async () => {
      await result.current.logout()
    })
    expect(result.current.error).toBe(SIGN_OUT_NEEDS_CONNECTION)
    await act(async () => resolveMe?.(grace))

    expect(result.current.unverified).toBe(false)
    expect(result.current.profile).toEqual(grace)
  })

  it('clears the message and succeeds on a retry once the connection is back', async () => {
    const { result } = await renderSignedIn()
    mocked(logout).mockRejectedValueOnce(new SyncNetworkError())
    await act(async () => {
      await result.current.logout()
    })
    expect(result.current.error).toBe(SIGN_OUT_NEEDS_CONNECTION)

    await act(async () => {
      await result.current.logout()
    })

    expect(result.current.error).toBeNull()
    expect(result.current.state).toBe('signedOut')
  })

  it('holds the outbox closed afterwards: a signed-out gate is not verified', async () => {
    const { result } = await renderSignedIn()
    mocked(setDrainsAllowed).mockClear()

    await act(async () => {
      await result.current.logout()
    })

    expect(mocked(setDrainsAllowed).mock.calls.at(-1)).toEqual([false])
  })

  it('falls back to a generic message for an unexpected failure', async () => {
    const { result } = await renderSignedIn()
    mocked(drainOutbox).mockRejectedValue('weird')

    await act(async () => {
      await result.current.logout()
    })

    expect(result.current.error).toBe('Something went wrong. Try again.')
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

  it('lets the user dismiss the prompt, and shows it again on the next 401', async () => {
    const { result } = await renderSignedIn()
    act(() => result.current.noteAuthRequired())

    act(() => result.current.dismissSignInPrompt())
    expect(result.current.needsSignIn).toBe(false)

    act(() => result.current.noteAuthRequired())
    expect(result.current.needsSignIn).toBe(true)
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

    it('opens the app straight away: no gate, no getMe, no cached identity logic', async () => {
      const { result } = renderHook(() => useAuth())

      await waitFor(() => expect(result.current.mode).toBe('none'))
      expect(result.current).toMatchObject({ state: 'signedIn', profile: null, unverified: false, needsSignIn: false })
      expect(getMe).not.toHaveBeenCalled()
      expect(putCachedIdentity).not.toHaveBeenCalled()
    })

    it('keeps the drain gate closed (no 401 churn), and never starts a drain', async () => {
      const { result } = renderHook(() => useAuth())
      await waitFor(() => expect(result.current.mode).toBe('none'))

      expect(mocked(setDrainsAllowed).mock.calls.at(-1)).toEqual([false])
      expect(drainOutbox).not.toHaveBeenCalled()
    })

    it('ignores a background 401: there is nothing to sign in to', async () => {
      const { result } = renderHook(() => useAuth())
      await waitFor(() => expect(result.current.mode).toBe('none'))

      act(() => result.current.noteAuthRequired())

      expect(result.current.needsSignIn).toBe(false)
    })

    it('reopens the gate on unmount, so nothing leaks into another mount', async () => {
      const { result, unmount } = renderHook(() => useAuth())
      await waitFor(() => expect(result.current.mode).toBe('none'))

      unmount()

      expect(mocked(setDrainsAllowed).mock.calls.at(-1)).toEqual([true])
    })

    it('treats a cached identity as local-only and leaves its data untouched', async () => {
      mocked(getCachedIdentity).mockResolvedValue(grace)
      const { result } = renderHook(() => useAuth())

      await waitFor(() => expect(result.current.mode).toBe('none'))

      expect(result.current.state).toBe('signedIn')
      expect(clearCachedIdentity).not.toHaveBeenCalled()
      expect(clearLocalData).not.toHaveBeenCalled()
    })
  })

  describe('when the server wants Google ("google")', () => {
    it('closes the drain gate from the very start and opens it only once the session is verified', async () => {
      const calls: boolean[] = []
      mocked(setDrainsAllowed).mockImplementation((allowed: boolean) => void calls.push(allowed))
      mocked(drainOutbox).mockImplementation(async () => {
        calls.push(true) // a drain starting
        return { processed: 0, stoppedReason: 'empty' }
      })

      const { result } = renderHook(() => useAuth())
      expect(calls[0]).toBe(false)
      await waitFor(() => expect(result.current.profile).toEqual(ada))
      await waitFor(() => expect(drainOutbox).toHaveBeenCalled())

      expect(calls.slice(0, calls.indexOf(true)).every((allowed) => allowed === false)).toBe(true)
      expect(calls.indexOf(true)).toBeGreaterThan(0)
    })

    it('keeps the gate closed, and starts no drain, while /auth/me cannot be reached', async () => {
      mocked(getCachedIdentity).mockResolvedValue(grace)
      mocked(getMe).mockRejectedValue(new SyncNetworkError())
      const { result } = renderHook(() => useAuth())
      await waitFor(() => expect(result.current.unverified).toBe(true))
      await act(async () => {})

      expect(mocked(setDrainsAllowed).mock.calls.at(-1)).toEqual([false])
      expect(drainOutbox).not.toHaveBeenCalled()
    })

    it('opens it once a later verification succeeds', async () => {
      mocked(getCachedIdentity).mockResolvedValue(grace)
      mocked(getMe).mockRejectedValue(new SyncNetworkError())
      const { result } = renderHook(() => useAuth())
      await waitFor(() => expect(result.current.unverified).toBe(true))
      await waitFor(() => expect(onlineListeners).toHaveLength(1))
      mocked(getMe).mockResolvedValue(grace)

      goOnline()

      await waitFor(() => expect(mocked(setDrainsAllowed).mock.calls.at(-1)).toEqual([true]))
      await waitFor(() => expect(drainOutbox).toHaveBeenCalled())
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
  })

  describe('when the server cannot be asked and nothing is cached ("unknown")', () => {
    beforeEach(() => mocked(getAuthConfig).mockResolvedValue(null))

    it('opens local-only instead of trapping an offline user: no gate, no getMe, no drains', async () => {
      const { result } = renderHook(() => useAuth())

      await waitFor(() => expect(result.current.mode).toBe('unknown'))

      expect(result.current).toMatchObject({ state: 'signedIn', profile: null, needsSignIn: false })
      expect(getMe).not.toHaveBeenCalled()
      expect(mocked(setDrainsAllowed).mock.calls.at(-1)).toEqual([false])
    })

    it('switches to the gate when the server later says Google, as for any never-verified session', async () => {
      const { result } = renderHook(() => useAuth())
      await waitFor(() => expect(result.current.mode).toBe('unknown'))
      mocked(getAuthConfig).mockResolvedValue(googleConfig)
      mocked(getMe).mockRejectedValue(new SyncAuthError(401, null))

      goOnline()

      await waitFor(() => expect(result.current.state).toBe('signedOut'))
      expect(result.current.mode).toBe('google')
    })

    it('stays open and local-only when the server later says login is off', async () => {
      const { result } = renderHook(() => useAuth())
      await waitFor(() => expect(result.current.mode).toBe('unknown'))
      mocked(getAuthConfig).mockResolvedValue(noLogin)

      goOnline()

      await waitFor(() => expect(result.current.mode).toBe('none'))
      expect(result.current.state).toBe('signedIn')
    })

    it('opens the app, verified, once Google is on and the browser already has a session', async () => {
      const { result } = renderHook(() => useAuth())
      await waitFor(() => expect(result.current.mode).toBe('unknown'))
      mocked(getAuthConfig).mockResolvedValue(googleConfig)

      goOnline()

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
    expect(clearLocalData).not.toHaveBeenCalled()
  })

  it('under dev:mocked skips the server entirely (sample data, no backend) and leaves the drain gate open', () => {
    ;(globalThis as { __LOGBOOK_MOCKED__?: boolean }).__LOGBOOK_MOCKED__ = true
    const { result } = renderHook(() => useAuth())
    expect(result.current).toMatchObject({ mode: 'mock', state: 'signedIn', unverified: false })
    expect(getAuthConfig).not.toHaveBeenCalled()
    expect(mocked(setDrainsAllowed).mock.calls.at(-1)).toEqual([true])
  })
})

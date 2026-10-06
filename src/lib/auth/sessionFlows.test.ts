import {
  LOADING,
  SIGNED_OUT,
  adoptAccount,
  ACCOUNT_PAUSE,
  AUTH_MODE_PAUSE,
  SIGNED_OUT_PAUSE,
  STARTUP_VERIFY_PAUSE,
  healRefusedDrain,
  LOCAL_PROBE_TIMEOUT_MS,
  SIGN_OUT_FLUSH_TIMEOUT_MS,
  probeLocalData,
  refreshAuthConfig,
  resolveAuthConfig,
  resolveStuckConfig,
  resolveStuckStartup,
  restoreSession,
  settleProfile,
  signInWithIdToken,
  signOut,
  unverifiedSession,
  verifiedSession,
  verifySession,
} from './sessionFlows.ts'
import { disableGoogleAutoSelect } from './googleIdentity.ts'
import {
  clearCachedIdentity,
  clearPendingLogout,
  getCachedAuthConfig,
  getCachedIdentity,
  hasPendingLogout,
  putCachedAuthConfig,
  putCachedIdentity,
  setPendingLogout,
} from '../db/identityStore.ts'
import { checkLocalOwner, claimLocalData, hasLocalData } from '../db/localOwner.ts'
import { getAuthConfig, getMe, loginWithGoogle, logout } from '../sync/authApi.ts'
import { SyncAuthError, SyncNetworkError } from '../sync/errors.ts'
import { drainOutbox, pauseDrains, resumeDrains } from '../sync/outboxRunner.ts'
import { UNKNOWN_CONFIG, knownConfig, type ConfigState } from './authConfig.ts'
import type { AuthProfile, Session } from '../../types/auth.ts'

jest.mock('./googleIdentity.ts', () => ({ disableGoogleAutoSelect: jest.fn() }))
jest.mock('../db/identityStore.ts')
jest.mock('../db/localOwner.ts')
jest.mock('../sync/authApi.ts')
jest.mock('../sync/outboxRunner.ts')

const ada: AuthProfile = { id: 'u1', email: 'ada@example.com', name: 'Ada', picture: null }
const grace: AuthProfile = { id: 'u2', email: 'grace@example.com', name: 'Grace', picture: null }

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.Mock

beforeEach(() => {
  jest.resetAllMocks()
  mocked(hasPendingLogout).mockResolvedValue(false)
  mocked(getCachedIdentity).mockResolvedValue(null)
  mocked(getMe).mockResolvedValue(ada)
  mocked(checkLocalOwner).mockResolvedValue('ok')
  mocked(hasLocalData).mockResolvedValue(false)
  mocked(logout).mockResolvedValue({ status: 'ok' })
  mocked(loginWithGoogle).mockResolvedValue({ status: 'ok' })
  mocked(drainOutbox).mockResolvedValue({ processed: 0, stoppedReason: 'empty' })
})

describe('session constructors', () => {
  it('LOADING and SIGNED_OUT carry no profile', () => {
    expect(LOADING).toMatchObject({ state: 'loading', profile: null })
    expect(SIGNED_OUT).toMatchObject({ state: 'signedOut', profile: null, pendingSwitch: null })
  })

  it('verifiedSession and unverifiedSession are signed in, differing in the unverified flag', () => {
    expect(verifiedSession(ada)).toEqual({ state: 'signedIn', profile: ada, unverified: false, pendingSwitch: null })
    expect(unverifiedSession(null)).toEqual({ state: 'signedIn', profile: null, unverified: true, pendingSwitch: null })
  })
})

describe('settleProfile', () => {
  it('caches the profile and returns a verified session for the device owner', async () => {
    const session = await settleProfile(ada)
    expect(putCachedIdentity).toHaveBeenCalledWith(ada)
    expect(session).toEqual(verifiedSession(ada))
  })

  it('returns a gate session with the pending switch, caching nothing, for a different account', async () => {
    mocked(checkLocalOwner).mockResolvedValue('mismatch')
    const session = await settleProfile(grace)
    expect(session).toEqual({ ...SIGNED_OUT, pendingSwitch: grace })
    expect(putCachedIdentity).not.toHaveBeenCalled()
  })

  it('pauses every drain on a mismatch, so the previous account\'s queue can\'t go up under the new session', async () => {
    mocked(checkLocalOwner).mockResolvedValue('mismatch')
    await settleProfile(grace)
    expect(pauseDrains).toHaveBeenCalledWith(ACCOUNT_PAUSE)
  })

  it('releases the account guard once the account is confirmed as the device owner', async () => {
    await settleProfile(ada)
    expect(pauseDrains).not.toHaveBeenCalled()
    expect(resumeDrains).toHaveBeenCalledWith(ACCOUNT_PAUSE)
  })

  it('does not release it on a mismatch', async () => {
    mocked(checkLocalOwner).mockResolvedValue('mismatch')
    await settleProfile(grace)
    expect(resumeDrains).not.toHaveBeenCalled()
  })

  it('does not cache when the signal has aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await settleProfile(ada, controller.signal)
    expect(putCachedIdentity).not.toHaveBeenCalled()
  })
})

describe('restoreSession', () => {
  async function run(signal = new AbortController().signal): Promise<Session[]> {
    const applied: Session[] = []
    await restoreSession(signal, (session) => applied.push(session))
    return applied
  }

  it('is verified when GET /auth/me succeeds', async () => {
    expect(await run()).toEqual([verifiedSession(ada)])
  })

  it('opens from the cached profile first, then verifies it', async () => {
    mocked(getCachedIdentity).mockResolvedValue(grace)
    mocked(getMe).mockResolvedValue(grace)
    expect(await run()).toEqual([unverifiedSession(grace), verifiedSession(grace)])
  })

  it('stays unverified on the cached profile when the backend is unreachable', async () => {
    mocked(getCachedIdentity).mockResolvedValue(grace)
    mocked(getMe).mockRejectedValue(new SyncNetworkError())
    expect(await run()).toEqual([unverifiedSession(grace), unverifiedSession(grace)])
  })

  it('shows the gate on a 401 even with a cached profile', async () => {
    mocked(getCachedIdentity).mockResolvedValue(grace)
    mocked(getMe).mockRejectedValue(new SyncAuthError(401, null))
    expect((await run()).at(-1)).toEqual(SIGNED_OUT)
    expect(clearCachedIdentity).not.toHaveBeenCalled()
  })

  it('opens unverified, with no profile, when offline with no cache but local entries (the pre-sign-in user)', async () => {
    mocked(getMe).mockRejectedValue(new SyncNetworkError())
    mocked(hasLocalData).mockResolvedValue(true)
    expect(await run()).toEqual([unverifiedSession(null)])
  })

  it('shows the gate when offline with no cache and nothing local', async () => {
    mocked(getMe).mockRejectedValue(new SyncNetworkError())
    expect(await run()).toEqual([SIGNED_OUT])
  })

  it('shows the gate on a 401 even when local entries exist', async () => {
    mocked(getMe).mockRejectedValue(new SyncAuthError(401, null))
    mocked(hasLocalData).mockResolvedValue(true)
    expect(await run()).toEqual([SIGNED_OUT])
  })

  it('honours a pending sign-out: retries the server logout and never calls GET /auth/me', async () => {
    mocked(hasPendingLogout).mockResolvedValue(true)
    expect(await run()).toEqual([SIGNED_OUT])
    expect(logout).toHaveBeenCalled()
    expect(clearPendingLogout).toHaveBeenCalled()
    expect(getMe).not.toHaveBeenCalled()
  })

  it('keeps the sign-out marker when the retry cannot reach the server', async () => {
    mocked(hasPendingLogout).mockResolvedValue(true)
    mocked(logout).mockRejectedValue(new SyncNetworkError())
    expect(await run()).toEqual([SIGNED_OUT])
    expect(clearPendingLogout).not.toHaveBeenCalled()
  })

  it('applies and caches nothing when superseded before the profile arrives', async () => {
    const controller = new AbortController()
    mocked(getMe).mockImplementation(async () => {
      controller.abort()
      return ada
    })
    expect(await run(controller.signal)).toEqual([])
    expect(putCachedIdentity).not.toHaveBeenCalled()
  })

  it('applies nothing when superseded before the cache is read', async () => {
    const controller = new AbortController()
    mocked(getCachedIdentity).mockImplementation(async () => {
      controller.abort()
      return grace
    })
    expect(await run(controller.signal)).toEqual([])
    expect(getMe).not.toHaveBeenCalled()
  })

  it('applies nothing when superseded during a failed check', async () => {
    const controller = new AbortController()
    mocked(getMe).mockImplementation(async () => {
      controller.abort()
      throw new SyncNetworkError()
    })
    expect(await run(controller.signal)).toEqual([])
  })

  it('does not apply a sign-out result when superseded during the logout retry', async () => {
    const controller = new AbortController()
    mocked(hasPendingLogout).mockResolvedValue(true)
    mocked(logout).mockImplementation(async () => {
      controller.abort()
      return { status: 'ok' }
    })
    expect(await run(controller.signal)).toEqual([])
  })

  it('does not apply the settled session when superseded while settling', async () => {
    const controller = new AbortController()
    mocked(checkLocalOwner).mockImplementation(async () => {
      controller.abort()
      return 'ok'
    })
    expect(await run(controller.signal)).toEqual([])
  })

  it('does not apply the post-failure session when superseded while deciding it', async () => {
    const controller = new AbortController()
    mocked(getMe).mockRejectedValue(new SyncNetworkError())
    mocked(hasLocalData).mockImplementation(async () => {
      controller.abort()
      return true
    })
    expect(await run(controller.signal)).toEqual([])
  })
})

describe('verifySession', () => {
  it('returns the confirmed session', async () => {
    expect(await verifySession()).toEqual(verifiedSession(ada))
  })

  it('returns "expired" on a 401', async () => {
    mocked(getMe).mockRejectedValue(new SyncAuthError(401, null))
    expect(await verifySession()).toBe('expired')
  })

  it('returns null when it still cannot tell', async () => {
    mocked(getMe).mockRejectedValue(new SyncNetworkError())
    expect(await verifySession()).toBeNull()
  })
})

describe('signInWithIdToken', () => {
  it('exchanges the token, clears any sign-out marker and settles the profile', async () => {
    expect(await signInWithIdToken('tok')).toEqual(verifiedSession(ada))
    expect(loginWithGoogle).toHaveBeenCalledWith('tok')
    expect(clearPendingLogout).toHaveBeenCalled()
  })

  it('retries the profile lookup once', async () => {
    mocked(getMe).mockRejectedValueOnce(new SyncNetworkError()).mockResolvedValue(ada)
    expect(await signInWithIdToken('tok')).toEqual(verifiedSession(ada))
    expect(getMe).toHaveBeenCalledTimes(2)
  })

  it('opens unverified, not stuck at the gate, when /auth/google worked but the profile cannot be fetched', async () => {
    mocked(getMe).mockRejectedValue(new SyncNetworkError())
    expect(await signInWithIdToken('tok')).toEqual(unverifiedSession(null))
    expect(getMe).toHaveBeenCalledTimes(2)
  })

  it('throws when /auth/google itself fails, leaving everything else alone', async () => {
    mocked(loginWithGoogle).mockRejectedValue(new SyncAuthError(403, null))
    await expect(signInWithIdToken('tok')).rejects.toBeInstanceOf(SyncAuthError)
    expect(clearPendingLogout).not.toHaveBeenCalled()
  })

  it('returns the pending switch for a different account, and leaves drains paused', async () => {
    mocked(checkLocalOwner).mockResolvedValue('mismatch')
    expect(await signInWithIdToken('tok')).toEqual({ ...SIGNED_OUT, pendingSwitch: ada })
    expect(resumeDrains).not.toHaveBeenCalledWith(ACCOUNT_PAUSE)
  })

  it('pauses drains before the new session exists, then releases them only after the owner check', async () => {
    const order: string[] = []
    mocked(pauseDrains).mockImplementation(async (reason: string) => void order.push(`pause:${reason}`))
    mocked(loginWithGoogle).mockImplementation(async () => {
      order.push('login')
      return { status: 'ok' }
    })
    mocked(checkLocalOwner).mockImplementation(async () => {
      order.push('owner-check')
      return 'ok'
    })
    mocked(resumeDrains).mockImplementation((reason: string) => void order.push(`resume:${reason}`))

    await signInWithIdToken('tok')

    expect(order[0]).toBe('pause:' + ACCOUNT_PAUSE)
    expect(order.indexOf('login')).toBeLessThan(order.indexOf('owner-check'))
    expect(order.indexOf('resume:' + ACCOUNT_PAUSE)).toBeGreaterThan(order.indexOf('owner-check'))
  })

  it('lifts the signed-out pause once /auth/google accepts the sign-in', async () => {
    await signInWithIdToken('tok')
    expect(resumeDrains).toHaveBeenCalledWith(SIGNED_OUT_PAUSE)
  })

  it('resumes the account guard (and nothing else) when /auth/google fails', async () => {
    mocked(loginWithGoogle).mockRejectedValue(new SyncNetworkError())
    await expect(signInWithIdToken('tok')).rejects.toBeInstanceOf(SyncNetworkError)
    expect(resumeDrains).toHaveBeenCalledWith(ACCOUNT_PAUSE)
    expect(resumeDrains).not.toHaveBeenCalledWith(SIGNED_OUT_PAUSE)
  })

  it('keeps drains paused when /auth/google worked but the profile could not be fetched (no owner check yet)', async () => {
    mocked(getMe).mockRejectedValue(new SyncNetworkError())

    const session = await signInWithIdToken('tok')

    expect(session).toEqual(unverifiedSession(null))
    expect(checkLocalOwner).not.toHaveBeenCalled()
    expect(resumeDrains).not.toHaveBeenCalledWith(ACCOUNT_PAUSE)
  })

  it('releases them later, when verification finally gets the profile and the owner matches', async () => {
    mocked(getMe).mockRejectedValue(new SyncNetworkError())
    await signInWithIdToken('tok')
    mocked(getMe).mockResolvedValue(ada)

    expect(await verifySession()).toEqual(verifiedSession(ada))

    expect(resumeDrains).toHaveBeenCalledWith(ACCOUNT_PAUSE)
  })
})

describe('adoptAccount', () => {
  it('removes the old local data, caches the profile and opens verified', async () => {
    expect(await adoptAccount(grace)).toEqual(verifiedSession(grace))
    expect(claimLocalData).toHaveBeenCalledWith('u2')
    expect(putCachedIdentity).toHaveBeenCalledWith(grace)
    expect(clearPendingLogout).toHaveBeenCalled()
  })

  it('resumes drains only after the old data is gone', async () => {
    const order: string[] = []
    mocked(claimLocalData).mockImplementation(async () => void order.push('claim'))
    mocked(resumeDrains).mockImplementation((reason: string) => void order.push(`resume:${reason}`))
    await adoptAccount(grace)
    expect(order).toEqual(['claim', 'resume:' + ACCOUNT_PAUSE, 'resume:' + SIGNED_OUT_PAUSE])
  })

  it('keeps drains paused when the old data cannot be cleared', async () => {
    mocked(claimLocalData).mockRejectedValue(new Error('boom'))
    await expect(adoptAccount(grace)).rejects.toThrow('boom')
    expect(resumeDrains).not.toHaveBeenCalled()
  })

  it('stops, caching nothing, when the old data cannot be cleared', async () => {
    mocked(claimLocalData).mockRejectedValue(new Error('boom'))
    await expect(adoptAccount(grace)).rejects.toThrow('boom')
    expect(putCachedIdentity).not.toHaveBeenCalled()
  })
})

describe('signOut', () => {
  it('records the marker, forgets the identity, logs out on the server and clears the marker', async () => {
    const order: string[] = []
    mocked(setPendingLogout).mockImplementation(async () => void order.push('marker'))
    mocked(clearCachedIdentity).mockImplementation(async () => void order.push('forget'))
    mocked(logout).mockImplementation(async () => {
      order.push('server')
      return { status: 'ok' }
    })

    await signOut(false)

    expect(order).toEqual(['marker', 'forget', 'server'])
    expect(clearPendingLogout).toHaveBeenCalled()
    expect(disableGoogleAutoSelect).toHaveBeenCalled()
    expect(drainOutbox).not.toHaveBeenCalled()
  })

  it('pauses drains (signed-out reason) before the marker, so an online event cannot upload on the live cookie', async () => {
    const order: string[] = []
    mocked(pauseDrains).mockImplementation(async (reason: string) => void order.push(`pause:${reason}`))
    mocked(setPendingLogout).mockImplementation(async () => void order.push('marker'))
    mocked(logout).mockRejectedValue(new SyncNetworkError())

    await signOut(false)

    expect(order).toEqual(['pause:' + SIGNED_OUT_PAUSE, 'marker'])
  })

  it('pauses only after the flush, so unsynced entries still get a chance to go up', async () => {
    const order: string[] = []
    mocked(drainOutbox).mockImplementation(async () => {
      order.push('flush')
      return { processed: 1, stoppedReason: 'empty' }
    })
    mocked(pauseDrains).mockImplementation(async () => void order.push('pause'))

    await signOut(true)

    expect(order).toEqual(['flush', 'pause'])
  })

  it('flushes the outbox first when asked, while the session is still valid', async () => {
    const order: string[] = []
    mocked(drainOutbox).mockImplementation(async () => {
      order.push('drain')
      return { processed: 1, stoppedReason: 'empty' }
    })
    mocked(setPendingLogout).mockImplementation(async () => void order.push('marker'))

    await signOut(true)

    expect(order).toEqual(['drain', 'marker'])
  })

  it('still signs out when the flush fails', async () => {
    mocked(drainOutbox).mockRejectedValue(new Error('boom'))
    await signOut(true)
    expect(setPendingLogout).toHaveBeenCalled()
  })

  describe('with a flush that never finishes', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    it('gives up on the flush after a bound and still signs out durably', async () => {
      mocked(drainOutbox).mockReturnValue(new Promise(() => undefined))
      const done = signOut(true)

      await jest.advanceTimersByTimeAsync(SIGN_OUT_FLUSH_TIMEOUT_MS)
      await done

      expect(setPendingLogout).toHaveBeenCalled()
      expect(clearCachedIdentity).toHaveBeenCalled()
      expect(logout).toHaveBeenCalled()
    })

    it('does not wait out the bound when the flush finishes', async () => {
      const done = signOut(true)
      await done
      expect(setPendingLogout).toHaveBeenCalled()
      expect(jest.getTimerCount()).toBe(0)
    })
  })

  it('keeps the marker when the server cannot be reached (offline sign-out)', async () => {
    mocked(logout).mockRejectedValue(new SyncNetworkError())
    await signOut(false)
    expect(setPendingLogout).toHaveBeenCalled()
    expect(clearPendingLogout).not.toHaveBeenCalled()
  })
})

describe('resolveStuckStartup', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('opens unverified when this device has local data (an existing user)', async () => {
    mocked(hasLocalData).mockResolvedValue(true)
    expect(await resolveStuckStartup()).toEqual(unverifiedSession(null))
  })

  it('returns null, so a first-time user keeps waiting on the splash, when there is nothing local', async () => {
    mocked(hasLocalData).mockResolvedValue(false)
    expect(await resolveStuckStartup()).toBeNull()
  })

  it('falls through to the gate when IndexedDB itself is what is stuck', async () => {
    mocked(hasLocalData).mockReturnValue(new Promise(() => undefined))
    const result = resolveStuckStartup()

    await jest.advanceTimersByTimeAsync(LOCAL_PROBE_TIMEOUT_MS)

    expect(await result).toEqual(SIGNED_OUT)
  })
})

describe('probeLocalData', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it.each([
    [true, 'data'],
    [false, 'none'],
  ] as const)('is %s -> "%s" when storage answers', async (has, expected) => {
    mocked(hasLocalData).mockResolvedValue(has)
    expect(await probeLocalData()).toBe(expected)
  })

  it('is "stuck" when storage does not answer in time', async () => {
    mocked(hasLocalData).mockReturnValue(new Promise(() => undefined))
    const result = probeLocalData()
    await jest.advanceTimersByTimeAsync(LOCAL_PROBE_TIMEOUT_MS)
    expect(await result).toBe('stuck')
  })
})

describe('refreshAuthConfig', () => {
  const google = { methods: [{ type: 'google' as const, clientId: 'id' }] }

  it('fetches the config and remembers it', async () => {
    mocked(getAuthConfig).mockResolvedValue(google)
    expect(await refreshAuthConfig()).toEqual(google)
    expect(putCachedAuthConfig).toHaveBeenCalledWith(google)
  })

  it('returns null, caching nothing, when the server cannot answer', async () => {
    mocked(getAuthConfig).mockResolvedValue(null)
    expect(await refreshAuthConfig()).toBeNull()
    expect(putCachedAuthConfig).not.toHaveBeenCalled()
  })
})

describe('resolveAuthConfig', () => {
  const google = { methods: [{ type: 'google' as const, clientId: 'id' }] }
  const none = { methods: [] }

  async function run(signal = new AbortController().signal): Promise<ConfigState[]> {
    const applied: ConfigState[] = []
    await resolveAuthConfig(signal, (state) => applied.push(state))
    return applied
  }

  it('uses the server\'s answer when there is no cache', async () => {
    mocked(getCachedAuthConfig).mockResolvedValue(null)
    mocked(getAuthConfig).mockResolvedValue(google)
    expect(await run()).toEqual([knownConfig(google)])
    expect(putCachedAuthConfig).toHaveBeenCalledWith(google)
  })

  it('opens from the cached config first, then takes the fresh answer', async () => {
    mocked(getCachedAuthConfig).mockResolvedValue(google)
    mocked(getAuthConfig).mockResolvedValue(none)
    expect(await run()).toEqual([knownConfig(google), knownConfig(none)])
  })

  it('keeps the cached config when the server cannot answer', async () => {
    mocked(getCachedAuthConfig).mockResolvedValue(google)
    mocked(getAuthConfig).mockResolvedValue(null)
    expect(await run()).toEqual([knownConfig(google)])
  })

  it('is "unknown" when there is neither a cache nor an answer', async () => {
    mocked(getCachedAuthConfig).mockResolvedValue(null)
    mocked(getAuthConfig).mockResolvedValue(null)
    expect(await run()).toEqual([UNKNOWN_CONFIG])
  })

  it('never touches the cached identity or local data, even when the server now says "none"', async () => {
    mocked(getCachedAuthConfig).mockResolvedValue(google)
    mocked(getAuthConfig).mockResolvedValue(none)
    await run()
    expect(clearCachedIdentity).not.toHaveBeenCalled()
    expect(claimLocalData).not.toHaveBeenCalled()
  })

  it('applies nothing when superseded before the cache is read', async () => {
    const controller = new AbortController()
    mocked(getCachedAuthConfig).mockImplementation(async () => {
      controller.abort()
      return google
    })
    expect(await run(controller.signal)).toEqual([])
    expect(getAuthConfig).not.toHaveBeenCalled()
  })

  it('applies nothing further when superseded while waiting for the server', async () => {
    const controller = new AbortController()
    mocked(getCachedAuthConfig).mockResolvedValue(null)
    mocked(getAuthConfig).mockImplementation(async () => {
      controller.abort()
      return google
    })
    expect(await run(controller.signal)).toEqual([])
  })
})

describe('resolveStuckConfig', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('opens as "unknown" (local-only) when this device has local data', async () => {
    mocked(hasLocalData).mockResolvedValue(true)
    expect(await resolveStuckConfig()).toEqual(UNKNOWN_CONFIG)
  })

  it('keeps a first-time user waiting on the splash (null) when nothing is local', async () => {
    mocked(hasLocalData).mockResolvedValue(false)
    expect(await resolveStuckConfig()).toBeNull()
  })

  it('opens as "unknown" rather than trapping anyone when storage itself is stuck', async () => {
    mocked(hasLocalData).mockReturnValue(new Promise(() => undefined))
    const result = resolveStuckConfig()
    await jest.advanceTimersByTimeAsync(LOCAL_PROBE_TIMEOUT_MS)
    expect(await result).toEqual(UNKNOWN_CONFIG)
  })
})

describe('pause reasons', () => {
  it('names distinct reasons so the account guard and the auth-mode guard cannot release each other', () => {
    expect(ACCOUNT_PAUSE).not.toBe(AUTH_MODE_PAUSE)
  })
})

describe('pause reasons are all distinct', () => {
  it('names a separate reason per guard, so none can release another', () => {
    const reasons = [ACCOUNT_PAUSE, AUTH_MODE_PAUSE, SIGNED_OUT_PAUSE, STARTUP_VERIFY_PAUSE]
    expect(new Set(reasons).size).toBe(4)
  })
})

describe('healRefusedDrain', () => {
  it('re-syncs the cookies with /auth/me, retries the drain, and reports it recovered', async () => {
    mocked(drainOutbox).mockResolvedValue({ processed: 1, stoppedReason: 'empty' })
    expect(await healRefusedDrain()).toBe('recovered')
    expect(getMe).toHaveBeenCalledTimes(1)
    expect(drainOutbox).toHaveBeenCalledTimes(1)
  })

  it('reports "refused" when the retried drain is refused again', async () => {
    mocked(drainOutbox).mockResolvedValue({ processed: 0, stoppedReason: 'auth', authStatus: 403 })
    expect(await healRefusedDrain()).toBe('refused')
  })

  it('reports "expired" when /auth/me shows the session really is gone, without retrying the drain', async () => {
    mocked(getMe).mockRejectedValue(new SyncAuthError(401, null))
    expect(await healRefusedDrain()).toBe('expired')
    expect(drainOutbox).not.toHaveBeenCalled()
  })

  it.each([
    ['a network failure', new SyncNetworkError()],
    ['a 403 from /auth/me', new SyncAuthError(403, null)],
  ])('reports "refused" for %s, without retrying the drain', async (_label, failure) => {
    mocked(getMe).mockRejectedValue(failure)
    expect(await healRefusedDrain()).toBe('refused')
    expect(drainOutbox).not.toHaveBeenCalled()
  })
})

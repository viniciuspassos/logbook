import {
  ACCOUNT_CHANGED_NOTICE,
  LOADING,
  SIGNED_OUT,
  SIGN_OUT_NEEDS_CONNECTION,
  SIGN_OUT_NEEDS_SIGN_IN,
  UnsyncedItemsError,
  isVerified,
  refreshAuthConfig,
  resolveAuthConfig,
  restoreSession,
  settleProfile,
  signInWithIdToken,
  signOut,
  startupFallback,
  unverifiedSession,
  verifiedSession,
  verifySession,
} from './sessionFlows.ts'
import { disableGoogleAutoSelect } from './googleIdentity.ts'
import {
  clearCachedIdentity,
  getCachedAuthConfig,
  getCachedIdentity,
  putCachedAuthConfig,
  putCachedIdentity,
} from '../db/identityStore.ts'
import { clearLocalData, countOutbox, hasLocalData } from '../db/localData.ts'
import { getAuthConfig, getMe, loginWithGoogle, logout } from '../sync/authApi.ts'
import { SyncAuthError, SyncHttpError, SyncNetworkError } from '../sync/errors.ts'
import { drainOutbox, type DrainSummary } from '../sync/outboxRunner.ts'
import { UNKNOWN_CONFIG, knownConfig, type ConfigState } from './authConfig.ts'
import type { AuthProfile, Session } from '../../types/auth.ts'

jest.mock('./googleIdentity.ts', () => ({ disableGoogleAutoSelect: jest.fn() }))
jest.mock('../db/identityStore.ts')
jest.mock('../db/localData.ts')
jest.mock('../sync/authApi.ts')
jest.mock('../sync/outboxRunner.ts')

const ada: AuthProfile = { id: 'u1', email: 'ada@example.com', name: 'Ada', picture: null }
const grace: AuthProfile = { id: 'u2', email: 'grace@example.com', name: 'Grace', picture: null }

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.Mock

function drained(stoppedReason: DrainSummary['stoppedReason']): DrainSummary {
  return { processed: 0, stoppedReason }
}

beforeEach(() => {
  jest.resetAllMocks()
  mocked(getCachedIdentity).mockResolvedValue(null)
  mocked(getMe).mockResolvedValue(ada)
  mocked(hasLocalData).mockResolvedValue(false)
  mocked(countOutbox).mockResolvedValue({ retryable: 0, parked: 0 })
  mocked(logout).mockResolvedValue({ status: 'ok' })
  mocked(loginWithGoogle).mockResolvedValue({ status: 'ok' })
  mocked(drainOutbox).mockResolvedValue(drained('empty'))
})

describe('session constructors', () => {
  it('LOADING and SIGNED_OUT carry no profile or notice', () => {
    expect(LOADING).toMatchObject({ state: 'loading', profile: null, notice: null })
    expect(SIGNED_OUT).toMatchObject({ state: 'signedOut', profile: null, notice: null })
  })

  it('verifiedSession and unverifiedSession are signed in, differing in the unverified flag', () => {
    expect(verifiedSession(ada)).toEqual({ state: 'signedIn', profile: ada, unverified: false, notice: null })
    expect(unverifiedSession(null)).toEqual({ state: 'signedIn', profile: null, unverified: true, notice: null })
  })

  it('isVerified is true only for a signed-in, confirmed session that knows who it is', () => {
    expect(isVerified(verifiedSession(ada))).toBe(true)
    expect(isVerified(verifiedSession(null))).toBe(false)
    expect(isVerified(unverifiedSession(ada))).toBe(false)
    expect(isVerified(SIGNED_OUT)).toBe(false)
    expect(isVerified(LOADING)).toBe(false)
  })
})

describe('settleProfile (one account per device)', () => {
  it('caches the profile and returns a verified session', async () => {
    expect(await settleProfile(ada)).toEqual(verifiedSession(ada))
    expect(putCachedIdentity).toHaveBeenCalledWith(ada)
    expect(clearLocalData).not.toHaveBeenCalled()
  })

  it('keeps everything for the same account (whatever the id type)', async () => {
    mocked(getCachedIdentity).mockResolvedValue({ ...ada, id: 1 })
    const session = await settleProfile({ ...ada, id: '1' })
    expect(session.notice).toBeNull()
    expect(clearLocalData).not.toHaveBeenCalled()
  })

  it('wipes local data and says so when a different account signs in', async () => {
    mocked(getCachedIdentity).mockResolvedValue(ada)

    const session = await settleProfile(grace)

    expect(clearLocalData).toHaveBeenCalledTimes(1)
    expect(session).toEqual(verifiedSession(grace, ACCOUNT_CHANGED_NOTICE))
    expect(putCachedIdentity).toHaveBeenCalledWith(grace)
  })

  it('wipes before caching the new identity', async () => {
    const order: string[] = []
    mocked(getCachedIdentity).mockResolvedValue(ada)
    mocked(clearLocalData).mockImplementation(async () => void order.push('wipe'))
    mocked(putCachedIdentity).mockImplementation(async () => void order.push('cache'))
    await settleProfile(grace)
    expect(order).toEqual(['wipe', 'cache'])
  })

  it('keeps existing local data when there is no cached identity to compare with (the first account adopts it)', async () => {
    await settleProfile(grace)
    expect(clearLocalData).not.toHaveBeenCalled()
  })

  it('caches nothing and rejects when the wipe fails', async () => {
    mocked(getCachedIdentity).mockResolvedValue(ada)
    mocked(clearLocalData).mockRejectedValue(new Error('boom'))
    await expect(settleProfile(grace)).rejects.toThrow('boom')
    expect(putCachedIdentity).not.toHaveBeenCalled()
  })

  it('does nothing destructive when a newer sign-in superseded the check (no wipe, no cache)', async () => {
    mocked(getCachedIdentity).mockResolvedValue(ada)
    const controller = new AbortController()
    mocked(getCachedIdentity).mockImplementation(async () => {
      controller.abort()
      return ada
    })

    await settleProfile(grace, controller.signal)

    expect(clearLocalData).not.toHaveBeenCalled()
    expect(putCachedIdentity).not.toHaveBeenCalled()
  })

  it('does not cache when the signal has aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await settleProfile(ada, controller.signal)
    expect(putCachedIdentity).not.toHaveBeenCalled()
  })
})

describe('startupFallback (the one rule for a slow or failed start)', () => {
  it('opens unverified on the cached identity', async () => {
    mocked(getCachedIdentity).mockResolvedValue(grace)
    expect(await startupFallback()).toEqual(unverifiedSession(grace))
  })

  it('opens unverified with no profile when the device holds local entries', async () => {
    mocked(hasLocalData).mockResolvedValue(true)
    expect(await startupFallback()).toEqual(unverifiedSession(null))
  })

  it('is null for a first-time device, so the caller keeps waiting (or shows the gate)', async () => {
    expect(await startupFallback()).toBeNull()
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

  it('opens from the cached identity first, then verifies it', async () => {
    mocked(getCachedIdentity).mockResolvedValue(grace)
    mocked(getMe).mockResolvedValue(grace)
    expect(await run()).toEqual([unverifiedSession(grace), verifiedSession(grace)])
  })

  it('stays unverified on the cached identity when the backend is unreachable', async () => {
    mocked(getCachedIdentity).mockResolvedValue(grace)
    mocked(getMe).mockRejectedValue(new SyncNetworkError())
    expect(await run()).toEqual([unverifiedSession(grace), unverifiedSession(grace)])
  })

  it('shows the gate on a 401 even with a cached identity, leaving that identity cached', async () => {
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

  it('wipes and says so when the server session is a different account than the cached identity', async () => {
    mocked(getCachedIdentity).mockResolvedValue(ada)
    mocked(getMe).mockResolvedValue(grace)

    const applied = await run()

    expect(clearLocalData).toHaveBeenCalledTimes(1)
    expect(applied.at(-1)).toEqual(verifiedSession(grace, ACCOUNT_CHANGED_NOTICE))
  })

  it('stays unverified on the cached identity when that wipe fails', async () => {
    mocked(getCachedIdentity).mockResolvedValue(ada)
    mocked(getMe).mockResolvedValue(grace)
    mocked(clearLocalData).mockRejectedValue(new Error('boom'))

    expect((await run()).at(-1)).toEqual(unverifiedSession(ada))
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

  it('does not apply the settled session when superseded while settling', async () => {
    const controller = new AbortController()
    mocked(getCachedIdentity).mockResolvedValueOnce(null).mockImplementationOnce(async () => {
      controller.abort()
      return null
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

  it('returns the wipe notice when it finds a different account', async () => {
    mocked(getCachedIdentity).mockResolvedValue(grace)
    expect((await verifySession()) as Session).toMatchObject({ notice: ACCOUNT_CHANGED_NOTICE })
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
  it('exchanges the token and settles the profile', async () => {
    expect(await signInWithIdToken('tok')).toEqual(verifiedSession(ada))
    expect(loginWithGoogle).toHaveBeenCalledWith('tok')
  })

  it('opens unverified, not stuck at the gate, when /auth/google worked but the profile cannot be fetched', async () => {
    mocked(getMe).mockRejectedValue(new SyncNetworkError())
    expect(await signInWithIdToken('tok')).toEqual(unverifiedSession(null))
  })

  it('opens unverified (verified again later) when settling the profile fails', async () => {
    mocked(getCachedIdentity).mockResolvedValue(ada)
    mocked(getMe).mockResolvedValue(grace)
    mocked(clearLocalData).mockRejectedValue(new Error('boom'))
    expect(await signInWithIdToken('tok')).toEqual(unverifiedSession(null))
  })

  it('throws when /auth/google itself fails, touching nothing else', async () => {
    mocked(loginWithGoogle).mockRejectedValue(new SyncAuthError(403, null))
    await expect(signInWithIdToken('tok')).rejects.toBeInstanceOf(SyncAuthError)
    expect(getMe).not.toHaveBeenCalled()
  })

  it('wipes and says so for a different account', async () => {
    mocked(getCachedIdentity).mockResolvedValue(grace)
    expect(await signInWithIdToken('tok')).toEqual(verifiedSession(ada, ACCOUNT_CHANGED_NOTICE))
    expect(clearLocalData).toHaveBeenCalledTimes(1)
  })
})

describe('signOut (needs a connection)', () => {
  it('syncs, checks the outbox is empty, signs out on the server, wipes local data, and only then forgets the identity', async () => {
    const order: string[] = []
    mocked(drainOutbox).mockImplementation(async () => {
      order.push('drain')
      return drained('empty')
    })
    mocked(countOutbox).mockImplementation(async () => {
      order.push('count')
      return { retryable: 0, parked: 0 }
    })
    mocked(logout).mockImplementation(async () => {
      order.push('server')
      return { status: 'ok' }
    })
    mocked(clearLocalData).mockImplementation(async () => void order.push('wipe'))
    mocked(clearCachedIdentity).mockImplementation(async () => void order.push('forget'))

    await signOut()

    expect(order).toEqual(['drain', 'count', 'server', 'wipe', 'forget'])
    expect(disableGoogleAutoSelect).toHaveBeenCalled()
  })

  it.each(['unreachable', 'error', 'aborted'] as const)(
    'refuses with a connect-and-sync message, changing nothing, when items are still queued and the drain ends %s',
    async (reason) => {
      mocked(drainOutbox).mockResolvedValue(drained(reason))
      mocked(countOutbox).mockResolvedValue({ retryable: 2, parked: 0 })

      await expect(signOut()).rejects.toThrow(SIGN_OUT_NEEDS_CONNECTION)

      expect(logout).not.toHaveBeenCalled()
      expect(clearCachedIdentity).not.toHaveBeenCalled()
      expect(clearLocalData).not.toHaveBeenCalled()
    },
  )

  it('refuses with a sign-in message when items are queued and the drain finds the session gone', async () => {
    mocked(drainOutbox).mockResolvedValue(drained('auth'))
    mocked(countOutbox).mockResolvedValue({ retryable: 1, parked: 0 })
    await expect(signOut()).rejects.toThrow(SIGN_OUT_NEEDS_SIGN_IN)
    expect(clearLocalData).not.toHaveBeenCalled()
  })

  it('proceeds when the outbox is empty even though the drain was a no-op (an unverified session has its drain gate closed)', async () => {
    mocked(drainOutbox).mockResolvedValue(drained('aborted'))
    await expect(signOut()).resolves.toBeUndefined()
    expect(logout).toHaveBeenCalled()
    expect(clearLocalData).toHaveBeenCalled()
  })

  it('refuses, changing nothing, and reports how many items can never sync when only parked ones remain', async () => {
    mocked(drainOutbox).mockResolvedValue(drained('rejected'))
    mocked(countOutbox).mockResolvedValue({ retryable: 0, parked: 3 })

    const failure = await signOut().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(UnsyncedItemsError)
    expect((failure as UnsyncedItemsError).count).toBe(3)
    expect(logout).not.toHaveBeenCalled()
    expect(clearLocalData).not.toHaveBeenCalled()
  })

  it('prefers the connect message when some items are retryable and some parked', async () => {
    mocked(countOutbox).mockResolvedValue({ retryable: 1, parked: 2 })
    mocked(drainOutbox).mockResolvedValue(drained('unreachable'))
    await expect(signOut()).rejects.toThrow(SIGN_OUT_NEEDS_CONNECTION)
  })

  it('discards the parked items and signs out when the user asked for exactly that, without draining or counting', async () => {
    mocked(countOutbox).mockResolvedValue({ retryable: 0, parked: 3 })

    await expect(signOut(true)).resolves.toBeUndefined()

    expect(drainOutbox).not.toHaveBeenCalled()
    expect(countOutbox).not.toHaveBeenCalled()
    expect(logout).toHaveBeenCalled()
    expect(clearLocalData).toHaveBeenCalled()
  })

  it('counts a 401 from /auth/logout as already signed out', async () => {
    mocked(logout).mockRejectedValue(new SyncAuthError(401, null))
    await expect(signOut()).resolves.toBeUndefined()
    expect(clearLocalData).toHaveBeenCalled()
  })

  it.each([
    ['a network failure', new SyncNetworkError()],
    ['a 500', new SyncHttpError(500, null, 'boom')],
    ['a 403', new SyncAuthError(403, null)],
  ])('refuses, changing nothing, when /auth/logout fails with %s', async (_label, failure) => {
    mocked(logout).mockRejectedValue(failure)

    await expect(signOut()).rejects.toThrow(SIGN_OUT_NEEDS_CONNECTION)

    expect(clearCachedIdentity).not.toHaveBeenCalled()
    expect(clearLocalData).not.toHaveBeenCalled()
  })

  it('keeps the cached identity, and says so, when the entries cannot be removed (so the data is never orphaned)', async () => {
    mocked(clearLocalData).mockRejectedValue(new Error('boom'))
    await expect(signOut()).rejects.toThrow("Couldn't remove this device's entries")
    expect(clearCachedIdentity).not.toHaveBeenCalled()
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
    expect(clearLocalData).not.toHaveBeenCalled()
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

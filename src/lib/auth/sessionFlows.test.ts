import {
  LOADING,
  SIGNED_OUT,
  adoptAccount,
  drainReachedServer,
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
  getCachedIdentity,
  hasPendingLogout,
  putCachedIdentity,
  setPendingLogout,
} from '../db/identityStore.ts'
import { checkLocalOwner, claimLocalData, hasLocalData } from '../db/localOwner.ts'
import { getMe, loginWithGoogle, logout } from '../sync/authApi.ts'
import { SyncAuthError, SyncNetworkError } from '../sync/errors.ts'
import { drainOutbox } from '../sync/outboxRunner.ts'
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

describe('drainReachedServer', () => {
  it.each([
    ['empty', true],
    ['auth', true],
    ['error', true],
    ['rejected', true],
    ['unreachable', false],
    ['unsupported', false],
    ['aborted', false],
  ] as const)('%s -> %s', (stoppedReason, expected) => {
    expect(drainReachedServer({ processed: 0, stoppedReason })).toBe(expected)
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

  it('returns the pending switch for a different account', async () => {
    mocked(checkLocalOwner).mockResolvedValue('mismatch')
    expect(await signInWithIdToken('tok')).toEqual({ ...SIGNED_OUT, pendingSwitch: ada })
  })
})

describe('adoptAccount', () => {
  it('removes the old local data, caches the profile and opens verified', async () => {
    expect(await adoptAccount(grace)).toEqual(verifiedSession(grace))
    expect(claimLocalData).toHaveBeenCalledWith('u2')
    expect(putCachedIdentity).toHaveBeenCalledWith(grace)
    expect(clearPendingLogout).toHaveBeenCalled()
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

  it('keeps the marker when the server cannot be reached (offline sign-out)', async () => {
    mocked(logout).mockRejectedValue(new SyncNetworkError())
    await signOut(false)
    expect(setPendingLogout).toHaveBeenCalled()
    expect(clearPendingLogout).not.toHaveBeenCalled()
  })
})

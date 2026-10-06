import { act, renderHook, waitFor } from '@testing-library/react'
import { useAuth } from './useAuth.ts'
import { useSyncOutbox } from './useSyncOutbox.ts'
import { getAuthConfig, getMe } from '../lib/sync/authApi.ts'
import { checkLocalOwner } from '../lib/db/localOwner.ts'
import { getAllRecords, hasRecord, removeRecord } from '../lib/db/outboxStore.ts'
import { putSyncState } from '../lib/db/syncStateStore.ts'
import { isBackendReachable } from '../lib/sync/health.ts'
import { createEntry } from '../lib/sync/entriesApi.ts'
import { SyncNetworkError } from '../lib/sync/errors.ts'
import type { AuthProfile } from '../types/auth.ts'

// The real outbox runner, with only its storage and network edges mocked, so
// this proves the ordering end to end: the drain that useSyncOutbox starts on
// mount must not upload anything before the session is matched to the device.
jest.mock('../lib/sync/authApi.ts')
jest.mock('../lib/auth/googleIdentity.ts', () => ({ disableGoogleAutoSelect: jest.fn() }))
jest.mock('../lib/db/identityStore.ts', () => ({
  getCachedIdentity: jest.fn().mockResolvedValue(null),
  putCachedIdentity: jest.fn().mockResolvedValue(undefined),
  clearCachedIdentity: jest.fn().mockResolvedValue(undefined),
  getCachedAuthConfig: jest.fn().mockResolvedValue(null),
  putCachedAuthConfig: jest.fn().mockResolvedValue(undefined),
  hasPendingLogout: jest.fn().mockResolvedValue(false),
  setPendingLogout: jest.fn().mockResolvedValue(undefined),
  clearPendingLogout: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../lib/db/localOwner.ts')
jest.mock('../lib/sync/connectivity.ts', () => ({ onBackOnline: jest.fn().mockReturnValue(() => undefined) }))
jest.mock('../lib/db/database.ts', () => ({ isPersistenceSupported: jest.fn().mockReturnValue(true) }))
jest.mock('../lib/db/outboxStore.ts')
jest.mock('../lib/db/syncStateStore.ts')
jest.mock('../lib/sync/health.ts')
jest.mock('../lib/sync/entriesApi.ts')
jest.mock('../lib/sync/attachmentsApi.ts')
jest.mock('../lib/sync/outboxQueue.ts')

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.Mock

const ada: AuthProfile = { id: 'a', email: 'a@x.co', name: null, picture: null }

function useApp() {
  const auth = useAuth()
  useSyncOutbox({ onAuthRequired: auth.noteAuthRequired })
  return auth
}

beforeEach(() => {
  jest.clearAllMocks()
  mocked(getAuthConfig).mockResolvedValue({ methods: [{ type: 'google', clientId: 'cid' }] })
  mocked(getMe).mockResolvedValue(ada)
  mocked(checkLocalOwner).mockResolvedValue('ok')
  mocked(isBackendReachable).mockResolvedValue(true)
  mocked(getAllRecords).mockResolvedValue([
    {
      queueId: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      attempts: 0,
      operation: { kind: 'create-entry', localEntryId: 1, payload: {} },
    },
  ])
  mocked(hasRecord).mockResolvedValue(true)
  mocked(removeRecord).mockResolvedValue(undefined)
  mocked(putSyncState).mockResolvedValue(undefined)
  mocked(createEntry).mockResolvedValue({ id: 9, version: 1 })
})

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

describe('the outbox never uploads before the session is matched to this device', () => {
  it('uploads once /auth/me answered and the owner matches', async () => {
    const { result } = renderHook(() => useApp())
    await waitFor(() => expect(result.current.profile).toEqual(ada))

    await waitFor(() => expect(createEntry).toHaveBeenCalledTimes(1))
  })

  it('never uploads while /auth/me is still pending, even though useSyncOutbox drained on mount', async () => {
    mocked(getMe).mockReturnValue(new Promise(() => undefined))
    renderHook(() => useApp())

    await settle()

    expect(createEntry).not.toHaveBeenCalled()
  })

  it('never uploads for a different account (the cookie is B, the data is A\'s)', async () => {
    mocked(checkLocalOwner).mockResolvedValue('mismatch')
    const { result } = renderHook(() => useApp())
    await waitFor(() => expect(result.current.pendingSwitch).toEqual(ada))

    await settle()

    expect(createEntry).not.toHaveBeenCalled()
  })

  it('never uploads while the server cannot be reached, so the owner was never checked', async () => {
    mocked(getMe).mockRejectedValue(new SyncNetworkError())
    const { result } = renderHook(() => useApp())
    await waitFor(() => expect(result.current.state).toBe('signedOut'))

    await settle()

    expect(createEntry).not.toHaveBeenCalled()
  })
})

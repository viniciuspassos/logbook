function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = jsonClone
}
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import {
  clearCachedIdentity,
  clearPendingLogout,
  getCachedAuthConfig,
  getCachedIdentity,
  getLocalOwnerId,
  hasPendingLogout,
  putCachedAuthConfig,
  putCachedIdentity,
  putLocalOwnerId,
  setPendingLogout,
} from './identityStore.ts'
import type { AuthProfile } from '../../types/auth.ts'

const ada: AuthProfile = { id: 'u1', email: 'ada@example.com', name: 'Ada', picture: null }

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

describe('getCachedIdentity', () => {
  it('is null when nobody has signed in on this device', async () => {
    expect(await getCachedIdentity()).toBeNull()
  })

  it('returns the profile stored by putCachedIdentity', async () => {
    await putCachedIdentity(ada)
    expect(await getCachedIdentity()).toEqual(ada)
  })

  it('is null instead of throwing when IndexedDB is unavailable', async () => {
    // @ts-expect-error simulating an environment without IndexedDB
    delete globalThis.indexedDB
    expect(await getCachedIdentity()).toBeNull()
  })

  it('ignores a malformed stored record', async () => {
    await putCachedIdentity({ nope: true } as unknown as AuthProfile)
    expect(await getCachedIdentity()).toBeNull()
  })
})

describe('a failing transaction', () => {
  interface FakeTx {
    error: Error
    onerror?: () => void
    onabort?: () => void
    objectStore: () => { get: () => object }
  }

  afterEach(() => jest.restoreAllMocks())

  it.each(['onerror', 'onabort'] as const)('degrades to null when the transaction fires %s', async (handler) => {
    await getCachedIdentity() // creates the database before the transaction is faked
    jest.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(() => {
      const tx: FakeTx = { error: new Error('boom'), objectStore: () => ({ get: () => ({}) }) }
      queueMicrotask(() => tx[handler]?.())
      return tx as unknown as IDBTransaction
    })

    expect(await getCachedIdentity()).toBeNull()
  })
})

describe('putCachedIdentity', () => {
  it('overwrites the previous profile (one account per device)', async () => {
    await putCachedIdentity(ada)
    await putCachedIdentity({ ...ada, email: 'grace@example.com' })
    expect(await getCachedIdentity()).toMatchObject({ email: 'grace@example.com' })
  })

  it('does not throw when IndexedDB is unavailable', async () => {
    // @ts-expect-error simulating an environment without IndexedDB
    delete globalThis.indexedDB
    await expect(putCachedIdentity(ada)).resolves.toBeUndefined()
  })
})

describe('clearCachedIdentity', () => {
  it('removes the profile', async () => {
    await putCachedIdentity(ada)
    await clearCachedIdentity()
    expect(await getCachedIdentity()).toBeNull()
  })

  it('does not throw when IndexedDB is unavailable', async () => {
    // @ts-expect-error simulating an environment without IndexedDB
    delete globalThis.indexedDB
    await expect(clearCachedIdentity()).resolves.toBeUndefined()
  })
})

describe('pending logout marker', () => {
  it('is absent until a sign-out sets it', async () => {
    expect(await hasPendingLogout()).toBe(false)
  })

  it('persists once set and is removed by clearPendingLogout', async () => {
    await setPendingLogout()
    expect(await hasPendingLogout()).toBe(true)

    await clearPendingLogout()
    expect(await hasPendingLogout()).toBe(false)
  })

  it('does not clobber the cached identity', async () => {
    await putCachedIdentity(ada)
    await setPendingLogout()
    expect(await getCachedIdentity()).toEqual(ada)
  })

  it('degrades when IndexedDB is unavailable', async () => {
    // @ts-expect-error simulating an environment without IndexedDB
    delete globalThis.indexedDB
    expect(await hasPendingLogout()).toBe(false)
    await expect(setPendingLogout()).resolves.toBeUndefined()
    await expect(clearPendingLogout()).resolves.toBeUndefined()
  })
})

describe('local owner id', () => {
  it('is null until recorded', async () => {
    expect(await getLocalOwnerId()).toBeNull()
  })

  it('round-trips and is overwritten by a later put', async () => {
    await putLocalOwnerId('u1')
    expect(await getLocalOwnerId()).toBe('u1')
    await putLocalOwnerId('u2')
    expect(await getLocalOwnerId()).toBe('u2')
  })

  it('survives a sign-out clearing the cached identity', async () => {
    await putLocalOwnerId('u1')
    await clearCachedIdentity()
    expect(await getLocalOwnerId()).toBe('u1')
  })
})

describe('cached auth config', () => {
  const google = { methods: [{ type: 'google' as const, clientId: 'id' }] }

  it('is null before the server has ever answered', async () => {
    expect(await getCachedAuthConfig()).toBeNull()
  })

  it('round-trips the last good config, including "login off"', async () => {
    await putCachedAuthConfig(google)
    expect(await getCachedAuthConfig()).toEqual(google)
    await putCachedAuthConfig({ methods: [] })
    expect(await getCachedAuthConfig()).toEqual({ methods: [] })
  })

  it('ignores a malformed stored record', async () => {
    await putCachedAuthConfig({ methods: 'nope' } as never)
    expect(await getCachedAuthConfig()).toBeNull()
  })

  it('survives a sign-out clearing the cached identity, and does not disturb it', async () => {
    await putCachedIdentity(ada)
    await putCachedAuthConfig(google)
    await clearCachedIdentity()
    expect(await getCachedAuthConfig()).toEqual(google)
  })

  it('degrades when IndexedDB is unavailable', async () => {
    // @ts-expect-error simulating an environment without IndexedDB
    delete globalThis.indexedDB
    expect(await getCachedAuthConfig()).toBeNull()
    await expect(putCachedAuthConfig(google)).resolves.toBeUndefined()
  })
})

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = jsonClone
}
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { clearCachedIdentity, getCachedIdentity, putCachedIdentity } from './identityStore.ts'
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

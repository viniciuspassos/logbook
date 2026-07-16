import { act, renderHook, waitFor } from '@testing-library/react'
import { useEntries } from './useEntries.ts'
import {
  getAllEntries,
  isPersistenceSupported,
  putEntries,
  putEntry,
} from '../lib/db/entriesStore.ts'
import type { Entry } from '../types/entry.ts'

jest.mock('../lib/db/entriesStore.ts', () => ({
  isPersistenceSupported: jest.fn(),
  getAllEntries: jest.fn(),
  putEntries: jest.fn().mockResolvedValue(undefined),
  putEntry: jest.fn().mockResolvedValue(undefined),
}))

const supportedMock = isPersistenceSupported as jest.Mock
const getAllMock = getAllEntries as jest.Mock
const putEntriesMock = putEntries as jest.Mock
const putEntryMock = putEntry as jest.Mock

function makeEntry(id: number, title = `Entry ${id}`): Entry {
  return {
    id,
    title,
    shape: 'triangle',
    location: 'Somewhere',
    date: 'Jul 3',
    metric: '',
    excerpt: '',
    weather: '',
    duration: '',
    difficulty: '',
    equipment: '',
    participants: '',
    raw: '',
    story: '',
    photoHint: '',
    media: ['a', 'b', 'c'],
    mapX: 50,
    mapY: 50,
  }
}

const seed = [makeEntry(2, 'Seed two'), makeEntry(1, 'Seed one')]

beforeEach(() => {
  jest.clearAllMocks()
  putEntriesMock.mockResolvedValue(undefined)
  putEntryMock.mockResolvedValue(undefined)
})

describe('useEntries', () => {
  it('falls back to the in-memory seed when persistence is unsupported', async () => {
    supportedMock.mockReturnValue(false)
    const { result } = renderHook(() => useEntries(seed))

    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.entries.map((e) => e.id)).toEqual([2, 1])
    expect(getAllMock).not.toHaveBeenCalled()
    expect(putEntriesMock).not.toHaveBeenCalled()
  })

  it('seeds the empty store on first run and shows the seed entries', async () => {
    supportedMock.mockReturnValue(true)
    getAllMock.mockResolvedValue([])
    const { result } = renderHook(() => useEntries(seed))

    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(putEntriesMock).toHaveBeenCalledWith(seed)
    expect(result.current.entries.map((e) => e.id)).toEqual([2, 1])
  })

  it('loads persisted entries instead of the seed when the store is populated', async () => {
    supportedMock.mockReturnValue(true)
    getAllMock.mockResolvedValue([makeEntry(9, 'Saved'), makeEntry(3)])
    const { result } = renderHook(() => useEntries(seed))

    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.entries.map((e) => e.id)).toEqual([9, 3])
    expect(putEntriesMock).not.toHaveBeenCalled()
  })

  it('prepends and persists a new entry via addEntry', async () => {
    supportedMock.mockReturnValue(true)
    getAllMock.mockResolvedValue([makeEntry(1)])
    const { result } = renderHook(() => useEntries(seed))
    await waitFor(() => expect(result.current.loaded).toBe(true))

    const fresh = makeEntry(2, 'Fresh')
    act(() => result.current.addEntry(fresh))

    expect(result.current.entries.map((e) => e.id)).toEqual([2, 1])
    await waitFor(() => expect(putEntryMock).toHaveBeenCalledWith(fresh))
  })

  it('still updates state when addEntry cannot persist', async () => {
    supportedMock.mockReturnValue(false)
    const { result } = renderHook(() => useEntries(seed))
    await waitFor(() => expect(result.current.loaded).toBe(true))

    act(() => result.current.addEntry(makeEntry(3, 'Fresh')))
    expect(result.current.entries[0].title).toBe('Fresh')
    expect(putEntryMock).not.toHaveBeenCalled()
  })
})

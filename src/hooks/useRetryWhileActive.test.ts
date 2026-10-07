import { act, renderHook } from '@testing-library/react'
import { RETRY_INTERVAL_MS, useRetryWhileActive } from './useRetryWhileActive.ts'
import { onBackOnline } from '../lib/sync/connectivity.ts'

jest.mock('../lib/sync/connectivity.ts')

let listeners: Array<() => void> = []

beforeEach(() => {
  jest.useFakeTimers()
  listeners = []
  ;(onBackOnline as jest.Mock).mockReset()
  ;(onBackOnline as jest.Mock).mockImplementation((listener: () => void) => {
    listeners.push(listener)
    return () => {
      listeners = listeners.filter((l) => l !== listener)
    }
  })
})

afterEach(() => jest.useRealTimers())

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms)
  })
}

describe('useRetryWhileActive', () => {
  it('does nothing while inactive', async () => {
    const attempt = jest.fn().mockResolvedValue(false)
    renderHook(() => useRetryWhileActive(false, attempt))

    await advance(RETRY_INTERVAL_MS * 3)

    expect(attempt).not.toHaveBeenCalled()
    expect(onBackOnline).not.toHaveBeenCalled()
  })

  it('tries straight away, then every interval, until an attempt succeeds', async () => {
    const attempt = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true)
    renderHook(() => useRetryWhileActive(true, attempt))

    await advance(0)
    expect(attempt).toHaveBeenCalledTimes(1)
    await advance(RETRY_INTERVAL_MS - 1)
    expect(attempt).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(attempt).toHaveBeenCalledTimes(2)
    await advance(RETRY_INTERVAL_MS)
    expect(attempt).toHaveBeenCalledTimes(3)

    await advance(RETRY_INTERVAL_MS * 5)
    expect(attempt).toHaveBeenCalledTimes(3)
    expect(listeners).toHaveLength(0)
  })

  it('also tries when the app may be reachable again (online, focus or visible)', async () => {
    const attempt = jest.fn().mockResolvedValue(false)
    renderHook(() => useRetryWhileActive(true, attempt))
    await advance(0)

    await act(async () => listeners.forEach((listener) => listener()))

    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('does not run two attempts at once', async () => {
    let finish: ((done: boolean) => void) | undefined
    const attempt = jest.fn().mockReturnValue(new Promise<boolean>((resolve) => (finish = resolve)))
    renderHook(() => useRetryWhileActive(true, attempt))
    await advance(0)

    await act(async () => listeners.forEach((listener) => listener()))
    await advance(RETRY_INTERVAL_MS)
    expect(attempt).toHaveBeenCalledTimes(1)

    await act(async () => finish?.(true))
  })

  it('treats an attempt that throws as a failed one and keeps trying', async () => {
    const attempt = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(true)
    renderHook(() => useRetryWhileActive(true, attempt))

    await advance(0)
    await advance(RETRY_INTERVAL_MS)

    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('always calls the latest attempt function', async () => {
    const first = jest.fn().mockResolvedValue(false)
    const second = jest.fn().mockResolvedValue(true)
    const { rerender } = renderHook(({ fn }) => useRetryWhileActive(true, fn), { initialProps: { fn: first } })
    await advance(0)

    rerender({ fn: second })
    await advance(RETRY_INTERVAL_MS)

    expect(second).toHaveBeenCalledTimes(1)
  })

  it('stops the timer and the listener on unmount or when it turns inactive', async () => {
    const attempt = jest.fn().mockResolvedValue(false)
    const { rerender, unmount } = renderHook(({ active }) => useRetryWhileActive(active, attempt), {
      initialProps: { active: true },
    })
    await advance(0)

    rerender({ active: false })
    expect(listeners).toHaveLength(0)
    await advance(RETRY_INTERVAL_MS * 3)
    expect(attempt).toHaveBeenCalledTimes(1)

    unmount()
  })
})

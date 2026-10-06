import { act, renderHook } from '@testing-library/react'
import { RETRY_CAP_MS, retryDelayMs, useBackoffRetry } from './useBackoffRetry.ts'
import { onBackOnline } from '../lib/sync/connectivity.ts'

jest.mock('../lib/sync/connectivity.ts')

const onBackOnlineMock = onBackOnline as jest.Mock

let onlineListeners: Array<() => void> = []

beforeEach(() => {
  jest.useFakeTimers()
  onlineListeners = []
  onBackOnlineMock.mockReset()
  onBackOnlineMock.mockImplementation((listener: () => void) => {
    onlineListeners.push(listener)
    return () => {
      onlineListeners = onlineListeners.filter((l) => l !== listener)
    }
  })
})

afterEach(() => jest.useRealTimers())

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms)
  })
}

describe('retryDelayMs', () => {
  it('backs off 15s, 30s, 60s, then settles at 5 minutes', () => {
    expect([0, 1, 2, 3, 4, 50].map(retryDelayMs)).toEqual([15_000, 30_000, 60_000, RETRY_CAP_MS, RETRY_CAP_MS, RETRY_CAP_MS])
    expect(RETRY_CAP_MS).toBe(300_000)
  })
})

describe('useBackoffRetry', () => {
  it('does nothing while inactive', async () => {
    const attempt = jest.fn().mockResolvedValue(false)
    renderHook(() => useBackoffRetry(false, attempt))

    await advance(10 * 60_000)

    expect(attempt).not.toHaveBeenCalled()
    expect(onBackOnlineMock).not.toHaveBeenCalled()
  })

  it('retries on the backoff schedule until it succeeds, then stops', async () => {
    const attempt = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true)
    renderHook(() => useBackoffRetry(true, attempt))

    await advance(14_999)
    expect(attempt).not.toHaveBeenCalled()
    await advance(1)
    expect(attempt).toHaveBeenCalledTimes(1)
    await advance(29_999)
    expect(attempt).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(attempt).toHaveBeenCalledTimes(2)
    await advance(60_000)
    expect(attempt).toHaveBeenCalledTimes(3)

    await advance(10 * 60_000)
    expect(attempt).toHaveBeenCalledTimes(3)
  })

  it('keeps going every 5 minutes once the backoff has capped', async () => {
    const attempt = jest.fn().mockResolvedValue(false)
    renderHook(() => useBackoffRetry(true, attempt))

    await advance(15_000 + 30_000 + 60_000)
    expect(attempt).toHaveBeenCalledTimes(3)
    await advance(RETRY_CAP_MS)
    expect(attempt).toHaveBeenCalledTimes(4)
    await advance(RETRY_CAP_MS)
    expect(attempt).toHaveBeenCalledTimes(5)
  })

  it('retries at once when connectivity returns, and restarts the backoff', async () => {
    const attempt = jest.fn().mockResolvedValue(false)
    renderHook(() => useBackoffRetry(true, attempt))
    await advance(15_000 + 30_000)
    expect(attempt).toHaveBeenCalledTimes(2)

    await act(async () => onlineListeners.forEach((listener) => listener()))
    expect(attempt).toHaveBeenCalledTimes(3)

    await advance(14_999)
    expect(attempt).toHaveBeenCalledTimes(3)
    await advance(1)
    expect(attempt).toHaveBeenCalledTimes(4)
  })

  it('stops listening and retrying once the attempt succeeds on reconnect', async () => {
    const attempt = jest.fn().mockResolvedValue(true)
    const { rerender } = renderHook(({ active }) => useBackoffRetry(active, attempt), { initialProps: { active: true } })

    await act(async () => onlineListeners.forEach((listener) => listener()))
    rerender({ active: false })

    expect(onlineListeners).toHaveLength(0)
    await advance(10 * 60_000)
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('does not run two attempts at once', async () => {
    let finish: ((done: boolean) => void) | undefined
    const attempt = jest.fn().mockReturnValue(new Promise<boolean>((resolve) => (finish = resolve)))
    renderHook(() => useBackoffRetry(true, attempt))
    await advance(15_000)

    await act(async () => onlineListeners.forEach((listener) => listener()))
    expect(attempt).toHaveBeenCalledTimes(1)

    await act(async () => finish?.(false))
  })

  it('treats an attempt that throws as a failed one and keeps retrying', async () => {
    const attempt = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(true)
    renderHook(() => useBackoffRetry(true, attempt))

    await advance(15_000)
    await advance(30_000)

    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('passes an abort signal and aborts it, plus the timer and listener, on unmount', async () => {
    const attempt = jest.fn().mockResolvedValue(false)
    const { unmount } = renderHook(() => useBackoffRetry(true, attempt))
    await advance(15_000)
    const signal = attempt.mock.calls[0][0] as AbortSignal

    unmount()

    expect(signal.aborted).toBe(true)
    expect(onlineListeners).toHaveLength(0)
    await advance(10 * 60_000)
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('always calls the latest attempt function', async () => {
    const first = jest.fn().mockResolvedValue(false)
    const second = jest.fn().mockResolvedValue(true)
    const { rerender } = renderHook(({ fn }) => useBackoffRetry(true, fn), { initialProps: { fn: first } })

    rerender({ fn: second })
    await advance(15_000)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})

import { useEffect, useRef } from 'react'
import { onBackOnline } from '../lib/sync/connectivity.ts'

const BACKOFF_MS = [15_000, 30_000, 60_000]
/** After the backoff steps it settles here, so a long outage doesn't hammer the server. */
export const RETRY_CAP_MS = 300_000

/** How long to wait before retry number `attempt` (0-based): 15s, 30s, 60s, then every 5 minutes. */
export function retryDelayMs(attempt: number): number {
  return BACKOFF_MS[attempt] ?? RETRY_CAP_MS
}

/**
 * While `active`, runs `attempt` on a backoff timer (15s, 30s, 60s, then every
 * 5 minutes) and again immediately whenever the browser comes back online
 * (restarting the backoff). `attempt` resolves `true` once it has what it
 * needed, which stops the retrying; a throw counts as a failed attempt. Only
 * one attempt runs at a time, and everything is cancelled on unmount or when
 * `active` turns off. Used to re-ask for the auth config and to re-verify a
 * session that couldn't be checked, neither of which can wait on a drain
 * (drains are held back until they succeed).
 */
export function useBackoffRetry(active: boolean, attempt: (signal: AbortSignal) => Promise<boolean>) {
  const attemptRef = useRef(attempt)
  useEffect(() => {
    attemptRef.current = attempt
  }, [attempt])

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let step = 0
    let running = false

    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void run(), retryDelayMs(step++))
    }
    const run = async () => {
      if (running || controller.signal.aborted) return
      running = true
      let done = false
      try {
        done = await attemptRef.current(controller.signal)
      } catch {
        // A failed attempt is just one more reason to try again later.
      } finally {
        running = false
      }
      if (!done && !controller.signal.aborted) schedule()
    }

    schedule()
    const stopListening = onBackOnline(() => {
      step = 0
      void run()
    })
    return () => {
      controller.abort()
      clearTimeout(timer)
      stopListening()
    }
  }, [active])
}

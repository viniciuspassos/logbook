import { useEffect, useRef } from 'react'
import { onBackOnline } from '../lib/sync/connectivity.ts'

/** How often an active retry tries again on its own. */
export const RETRY_INTERVAL_MS = 30_000

/**
 * While `active`, runs `attempt` straight away, then every 30 seconds, and
 * again whenever the app may be reachable (online, focus, tab visible): the
 * first sign of a recovered network is often none of those events. `attempt`
 * resolves `true` once it has what it needed, which stops everything; a throw
 * counts as a failed attempt. One attempt at a time. Used to re-verify an
 * unverified session and to re-ask for an unknown auth config.
 */
export function useRetryWhileActive(active: boolean, attempt: () => Promise<boolean>) {
  const attemptRef = useRef(attempt)
  useEffect(() => {
    attemptRef.current = attempt
  }, [attempt])

  useEffect(() => {
    if (!active) return
    let running = false
    const stop = () => {
      clearInterval(timer)
      stopListening()
    }
    const run = async () => {
      if (running) return
      running = true
      let done = false
      try {
        done = await attemptRef.current()
      } catch {
        // A failed attempt is just one more reason to try again later.
      } finally {
        running = false
      }
      if (done) stop()
    }
    const timer = setInterval(() => void run(), RETRY_INTERVAL_MS)
    const stopListening = onBackOnline(() => void run())
    void run()
    return stop
  }, [active])
}

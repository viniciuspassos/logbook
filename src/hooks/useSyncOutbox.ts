import { useCallback, useEffect } from 'react'
import { drainOutbox, startAutoSync } from '../lib/sync/outboxRunner.ts'
import { queueEntryCreate as queueEntryCreateOp } from '../lib/sync/outboxQueue.ts'
import type { Entry } from '../types/entry.ts'

/**
 * Owns #26's background sync: registers the reconnect trigger (via
 * outboxRunner.ts's startAutoSync, so this hook never touches `window`
 * itself) and does one drain attempt on mount in case the backend was
 * already reachable when the app opened. Exposes `queueEntryCreate` for
 * useLogbookApp.saveEntry to call once a new entry is saved locally.
 *
 * Deliberately its own hook rather than folded into useEntries: useEntries
 * owns the local IndexedDB-backed list (#26 keeps that unchanged and
 * authoritative — see CLAUDE.md's "Source of truth is moving to the
 * server" note), while this hook owns the *additive* server-sync concern on
 * top of it. Splitting them keeps useEntries's existing tests/behaviour
 * untouched and stops useLogbookApp from having to know outbox internals.
 */
export function useSyncOutbox() {
  useEffect(() => {
    void drainOutbox()
    return startAutoSync()
  }, [])

  const queueEntryCreate = useCallback((entry: Entry) => {
    void (async () => {
      try {
        await queueEntryCreateOp(entry)
      } catch {
        // outboxQueue.queueEntryCreate already swallows its own failures;
        // this catch is defence-in-depth so a future change there can never
        // turn into an unhandled rejection here.
      } finally {
        // Kick a drain regardless: queueing may have no-op'd (unsupported
        // storage) but a drain is always safe to attempt and harmless if
        // there's nothing to send.
        void drainOutbox()
      }
    })()
  }, [])

  return { queueEntryCreate }
}

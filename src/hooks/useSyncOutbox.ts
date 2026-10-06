import { useCallback, useEffect, useState } from 'react'
import {
  drainOutbox,
  startAutoSync,
  subscribeToDrains,
  type DrainSummary,
} from '../lib/sync/outboxRunner.ts'
import {
  queueAttachmentUpload as queueAttachmentUploadOp,
  queueEntryCreate as queueEntryCreateOp,
  queueEntryCreates as queueEntryCreatesOp,
  queueEntryDeletion as queueEntryDeletionOp,
} from '../lib/sync/outboxQueue.ts'
import { syncStatusLabel } from '../lib/sync/syncStatus.ts'
import type { Entry } from '../types/entry.ts'

export interface UseSyncOutboxOptions {
  /** A drain discovered the session is gone (a 401/403 mid-queue). */
  onAuthRequired?: () => void
  /** A drain actually got a mutating call through, so the session is good. */
  onAuthConfirmed?: () => void
}

/**
 * Owns #26's background sync: registers the reconnect trigger (via
 * outboxRunner.ts's startAutoSync, so this hook never touches `window`
 * itself) and does one drain attempt on mount in case the backend was
 * already reachable when the app opened. Exposes `queueEntryCreate` for
 * useLogbookApp.saveEntry to call once a new entry is saved locally,
 * `queueEntryCreates` for a backup restore to queue every restored entry,
 * `queueEntryDeletion` for useLogbookApp.deleteEntry, and
 * `syncStatus`, the timeline's sync line, from the last drain that finished
 * anywhere in the app (outboxRunner.ts's subscribeToDrains).
 *
 * Deliberately its own hook rather than folded into useEntries: useEntries
 * owns the local IndexedDB-backed list (#26 keeps that unchanged and
 * authoritative — see CLAUDE.md's "Source of truth is moving to the
 * server" note), while this hook owns the *additive* server-sync concern on
 * top of it. Splitting them keeps useEntries's existing tests/behaviour
 * untouched and stops useLogbookApp from having to know outbox internals.
 *
 * Auth *state* itself is owned by useAuth.ts, not here — this hook only
 * forwards what a drain happens to discover about the session (via the
 * optional `onAuthRequired`/`onAuthConfirmed` callbacks) since draining is
 * the only place that ever finds out.
 */
export function useSyncOutbox(options: UseSyncOutboxOptions = {}) {
  const { onAuthRequired, onAuthConfirmed } = options
  const [lastDrain, setLastDrain] = useState<DrainSummary | null>(null)

  // Every drain, wherever it started (mount, save, photo upload, sign-in, the
  // `online` event), updates the status line and says something about the
  // session, so both are read from the runner's subscription rather than
  // only from the drains this hook kicks itself.
  useEffect(
    () =>
      subscribeToDrains((summary) => {
        // An aborted pass says nothing new about the queue or the session.
        if (summary.stoppedReason === 'aborted') return
        setLastDrain(summary)
        if (summary.stoppedReason === 'auth') onAuthRequired?.()
        else if (summary.processed > 0) onAuthConfirmed?.()
      }),
    [onAuthRequired, onAuthConfirmed],
  )

  useEffect(() => {
    void drainOutbox()
    return startAutoSync()
  }, [])

  // Queue, then drain regardless: queueing may have no-op'd (unsupported
  // storage) but a drain is always safe to attempt and harmless if there's
  // nothing to send. The catch is defence-in-depth — the queue functions
  // already swallow their own failures — so a future change there can never
  // turn into an unhandled rejection here.
  const queueThenDrain = useCallback((queue: () => Promise<void>) => {
    void (async () => {
      try {
        await queue()
      } catch {
        // See above.
      } finally {
        await drainOutbox()
      }
    })()
  }, [])

  const queueEntryCreate = useCallback(
    (entry: Entry) => queueThenDrain(() => queueEntryCreateOp(entry)),
    [queueThenDrain],
  )

  // Photos chosen while creating the entry: queueAttachmentUpload queues the
  // entry's create ahead of the first upload itself, so order is preserved.
  const queueEntryWithPhotos = useCallback(
    (entry: Entry, files: File[]) =>
      queueThenDrain(async () => {
        await queueEntryCreateOp(entry)
        for (const file of files) await queueAttachmentUploadOp(entry, file, file.name)
      }),
    [queueThenDrain],
  )

  const queueEntryCreates = useCallback(
    (entries: Entry[]) => queueThenDrain(() => queueEntryCreatesOp(entries)),
    [queueThenDrain],
  )

  const queueEntryDeletion = useCallback(
    (localEntryId: number) => queueThenDrain(() => queueEntryDeletionOp(localEntryId)),
    [queueThenDrain],
  )

  return { queueEntryCreate, queueEntryWithPhotos, queueEntryCreates, queueEntryDeletion, syncStatus: syncStatusLabel(lastDrain) }
}

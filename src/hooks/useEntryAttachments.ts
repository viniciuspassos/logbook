import { useCallback, useEffect, useRef, useState } from 'react'
import { attachmentFileUrl } from '../lib/sync/attachmentsApi.ts'
import { validateAttachmentFile } from '../lib/sync/attachmentValidation.ts'
import {
  discardRejectedOperation,
  getEntryAttachmentSources,
  queueAttachmentDelete,
  queueAttachmentUpload,
} from '../lib/sync/outboxQueue.ts'
import { drainOutbox, type DrainSummary } from '../lib/sync/outboxRunner.ts'
import type { Entry } from '../types/entry.ts'
import type { OutboxRecord } from '../types/outbox.ts'

export interface AttachmentPreview {
  key: string
  url: string
  /** Still queued locally, not yet confirmed by the server. */
  pending: boolean
  /** The outbox op behind a locally-queued photo (absent for server ones). */
  queueId?: number
  /** The server's id for an already-uploaded photo (absent for queued ones). */
  attachmentId?: number
  /** Set when the server permanently rejected the upload (#91): the photo
   *  will never sync, so the gallery offers to discard it. */
  rejectedReason?: string
}

/** The first photo rejected in `after` that wasn't already rejected in `before`. */
function findNewRejection(before: AttachmentPreview[], after: AttachmentPreview[]): AttachmentPreview | undefined {
  const alreadyRejected = new Set(before.filter((p) => p.rejectedReason !== undefined).map((p) => p.key))
  return after.find((p) => p.rejectedReason !== undefined && !alreadyRejected.has(p.key))
}

export interface AttachmentStatus {
  tone: 'info' | 'error'
  message: string
}

const PHOTO_REMOVED: AttachmentStatus = { tone: 'info', message: 'Photo removed.' }

/**
 * Takes a photo out of the outbox's hands: drops its queued upload if it
 * never reached the server, or queues a server-side delete if it did.
 * Resolves `true` when that delete still has to be drained.
 */
async function dropPhoto(entry: Entry, preview: AttachmentPreview): Promise<boolean> {
  if (preview.queueId !== undefined) {
    if (!(await discardRejectedOperation(preview.queueId))) throw new Error("Couldn't drop the queued photo.")
    return false
  }
  if (preview.attachmentId === undefined) return false
  await queueAttachmentDelete(entry.id, preview.attachmentId)
  return true
}

/** What to tell the user after draining a queued photo delete. */
function removalStatus(summary: DrainSummary): AttachmentStatus {
  if (summary.processed > 0) return PHOTO_REMOVED
  if (summary.stoppedReason === 'auth') {
    return { tone: 'info', message: 'Photo removed here — sign in to remove it from the server.' }
  }
  if (summary.stoppedReason === 'rejected') {
    return { tone: 'error', message: `The server refused to remove this photo (${summary.error}).` }
  }
  return { tone: 'info', message: "Photo removed here — it'll be removed from the server once you're back online." }
}

export interface UseEntryAttachmentsOptions {
  /** The upload's drain discovered the session is gone (a 401/403). */
  onAuthRequired?: () => void
  /** The upload's drain actually got a mutating call through. */
  onAuthConfirmed?: () => void
}

/**
 * Owns the attachment gallery for whichever entry is currently open in
 * EntryDetailOverlay: the merged list of server-confirmed + locally-queued
 * photos, the upload flow (validate -> queue -> drain -> refresh), and
 * removing a single photo without touching the entry.
 * Parameterized by `entry` (re-runs its load on id change) rather than
 * living in useLogbookApp itself, per CLAUDE.md's hook-ownership rule —
 * this is a distinct concern from navigation/entries/new-entry/export.
 *
 * `URL.createObjectURL` is used directly (not behind a `src/lib` wrapper):
 * it's a standard, non-flag-gated Web API — unlike the AI/speech/IndexedDB/
 * File-System-Access globals CLAUDE.md's layering rule calls out — but is
 * still guarded with a `typeof` check (jsdom doesn't implement it) and its
 * lifecycle (create per pending file, revoke on the next load/unmount) is
 * kept local to this hook since it's tied 1:1 to this hook's own state.
 */
export function useEntryAttachments(
  entry: Entry | null,
  options: UseEntryAttachmentsOptions = {},
): {
  attachments: AttachmentPreview[]
  busy: boolean
  status: AttachmentStatus | null
  addPhoto: (file: File) => void
  discardPhoto: (queueId: number) => void
  removePhoto: (preview: AttachmentPreview) => void
} {
  const { onAuthRequired, onAuthConfirmed } = options
  const [attachments, setAttachments] = useState<AttachmentPreview[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<AttachmentStatus | null>(null)
  const objectUrlsRef = useRef<string[]>([])
  // Which entry `addPhoto`'s in-flight async work is still allowed to touch
  // state for. Without this, opening entry A, adding a photo, then quickly
  // switching to entry B before the queue+drain settles would let entry A's
  // stale status/attachments overwrite entry B's freshly-loaded gallery.
  const activeEntryIdRef = useRef<number | null>(entry?.id ?? null)

  const revokeObjectUrls = useCallback(() => {
    if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return
    for (const url of objectUrlsRef.current) URL.revokeObjectURL(url)
    objectUrlsRef.current = []
  }, [])

  const buildPreviews = useCallback(
    (serverAttachments: { id: number }[], pending: OutboxRecord[]): AttachmentPreview[] => {
      revokeObjectUrls()
      const server: AttachmentPreview[] = serverAttachments.map((attachment) => ({
        key: `server-${attachment.id}`,
        url: attachmentFileUrl(attachment.id),
        pending: false,
        attachmentId: attachment.id,
      }))
      const canCreateObjectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      const pendingPreviews: AttachmentPreview[] = pending.map((record) => {
        const file = record.operation.kind === 'upload-attachment' ? record.operation.file : new Blob()
        const url = canCreateObjectUrl ? URL.createObjectURL(file) : ''
        if (url) objectUrlsRef.current.push(url)
        const preview: AttachmentPreview = { key: `pending-${record.queueId}`, url, pending: !record.rejected, queueId: record.queueId }
        if (record.rejected) preview.rejectedReason = record.lastError ?? 'Rejected by the server.'
        return preview
      })
      return [...server, ...pendingPreviews]
    },
    [revokeObjectUrls],
  )

  const load = useCallback(
    async (target: Entry, signal?: AbortSignal): Promise<AttachmentPreview[]> => {
      const sources = await getEntryAttachmentSources(target, signal)
      if (signal?.aborted) return []
      const previews = buildPreviews(sources.serverAttachments, sources.pending)
      setAttachments(previews)
      return previews
    },
    [buildPreviews],
  )

  useEffect(() => {
    const controller = new AbortController()
    activeEntryIdRef.current = entry?.id ?? null
    // Reset/(re)load happens inside a callback rather than directly in the
    // effect body: this entry's attachment list is genuinely external state
    // (fetched from the server, or read from the outbox), not something
    // derivable from props/state during render.
    void (async () => {
      // A newly-opened entry starts from a clean slate: any status/busy left
      // over from a previous entry's in-flight upload must not bleed into
      // this one (addPhoto's own continuation also checks activeEntryIdRef,
      // but resetting here covers the case where nothing is in flight and
      // the last entry simply left a status message on screen).
      setStatus(null)
      setBusy(false)
      if (!entry) {
        revokeObjectUrls()
        setAttachments([])
        return
      }
      await load(entry, controller.signal)
    })()
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id])

  useEffect(() => revokeObjectUrls, [revokeObjectUrls])

  const reportDrain = useCallback(
    (summary: DrainSummary, rejection: AttachmentPreview | undefined) => {
      if (rejection) {
        setStatus({
          tone: 'error',
          message: `The server rejected this photo (${rejection.rejectedReason}). Remove it and try another.`,
        })
      } else if (summary.processed > 0) {
        setStatus({ tone: 'info', message: 'Photo uploaded.' })
        onAuthConfirmed?.()
      } else if (summary.stoppedReason === 'auth') {
        // Distinguishes "you're not signed in" from "you're offline" —
        // the generic offline message below would otherwise be shown for
        // both, which is what prompted this hook's auth-awareness (see
        // the bug this fixes: a reachable-but-unauthenticated backend
        // looked identical to no connectivity at all).
        setStatus({ tone: 'info', message: 'Photo queued — sign in to sync it.' })
        onAuthRequired?.()
      } else {
        setStatus({ tone: 'info', message: "Photo queued — it'll upload once you're back online." })
      }
    },
    [onAuthRequired, onAuthConfirmed],
  )

  const addPhoto = useCallback(
    (file: File) => {
      if (!entry) return
      const validation = validateAttachmentFile(file)
      if (!validation.ok) {
        setStatus({ tone: 'error', message: validation.reason })
        return
      }
      const entryId = entry.id
      const isStale = () => activeEntryIdRef.current !== entryId
      setStatus(null)
      setBusy(true)
      void (async () => {
        try {
          await queueAttachmentUpload(entry, file, file.name)
          if (isStale()) return
          const before = await load(entry)
          if (isStale()) return
          const summary = await drainOutbox()
          if (isStale()) return
          const changed = summary.processed > 0 || summary.stoppedReason === 'rejected'
          const after = changed ? await load(entry) : before
          if (isStale()) return
          reportDrain(summary, findNewRejection(before, after))
        } catch {
          if (!isStale()) setStatus({ tone: 'error', message: "Couldn't queue that photo. Try again." })
        } finally {
          if (!isStale()) setBusy(false)
        }
      })()
    },
    [entry, load, reportDrain],
  )

  /** Drops a photo the server permanently rejected (#91) from the outbox. */
  const discardPhoto = useCallback(
    (queueId: number) => {
      if (!entry) return
      const entryId = entry.id
      const isStale = () => activeEntryIdRef.current !== entryId
      void (async () => {
        const removed = await discardRejectedOperation(queueId)
        if (isStale()) return
        if (!removed) {
          setStatus({ tone: 'error', message: "Couldn't remove that photo. Try again." })
          return
        }
        await load(entry)
        if (!isStale()) setStatus({ tone: 'info', message: 'Photo removed.' })
        // Re-drain so the timeline's sync line (fed by every drain) stops
        // saying "some changes rejected" once nothing rejected is left.
        void drainOutbox()
      })()
    },
    [entry, load],
  )

  /** Drains a queued server-side photo delete and reports how far it got,
   *  forwarding what the drain learned about the session. */
  const syncRemoval = useCallback(
    async (target: Entry, isStale: () => boolean): Promise<AttachmentStatus | null> => {
      const summary = await drainOutbox()
      if (isStale()) return null
      if (summary.processed > 0) {
        await load(target)
        onAuthConfirmed?.()
      } else if (summary.stoppedReason === 'auth') {
        onAuthRequired?.()
      }
      return removalStatus(summary)
    },
    [load, onAuthRequired, onAuthConfirmed],
  )

  /**
   * Removes one photo, leaving the entry alone. It disappears from the
   * gallery straight away (getEntryAttachmentSources hides photos with a
   * queued delete), even offline; an uploaded one is then deleted on the
   * server by the drain.
   */
  const removePhoto = useCallback(
    (preview: AttachmentPreview) => {
      if (!entry) return
      const target = entry
      const isStale = () => activeEntryIdRef.current !== target.id
      setStatus(null)
      setBusy(true)
      void (async () => {
        try {
          const needsSync = await dropPhoto(target, preview)
          if (isStale()) return
          await load(target)
          if (isStale()) return
          const next = needsSync ? await syncRemoval(target, isStale) : PHOTO_REMOVED
          if (next && !isStale()) setStatus(next)
        } catch {
          if (!isStale()) setStatus({ tone: 'error', message: "Couldn't remove that photo. Try again." })
        } finally {
          if (!isStale()) setBusy(false)
        }
      })()
    },
    [entry, load, syncRemoval],
  )

  return { attachments, busy, status, addPhoto, discardPhoto, removePhoto }
}

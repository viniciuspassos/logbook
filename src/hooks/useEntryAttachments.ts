import { useCallback, useEffect, useRef, useState } from 'react'
import { attachmentFileUrl } from '../lib/sync/attachmentsApi.ts'
import { validateAttachmentFile } from '../lib/sync/attachmentValidation.ts'
import { getEntryAttachmentSources, queueAttachmentUpload } from '../lib/sync/outboxQueue.ts'
import { drainOutbox } from '../lib/sync/outboxRunner.ts'
import type { Entry } from '../types/entry.ts'
import type { OutboxRecord } from '../types/outbox.ts'

export interface AttachmentPreview {
  key: string
  url: string
  /** Still queued locally, not yet confirmed by the server. */
  pending: boolean
}

export interface AttachmentStatus {
  tone: 'info' | 'error'
  message: string
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
 * photos, and the upload flow (validate -> queue -> drain -> refresh).
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
      }))
      const canCreateObjectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      const pendingPreviews: AttachmentPreview[] = pending.map((record) => {
        const file = record.operation.kind === 'upload-attachment' ? record.operation.file : new Blob()
        const url = canCreateObjectUrl ? URL.createObjectURL(file) : ''
        if (url) objectUrlsRef.current.push(url)
        return { key: `pending-${record.queueId}`, url, pending: true }
      })
      return [...server, ...pendingPreviews]
    },
    [revokeObjectUrls],
  )

  const load = useCallback(
    async (target: Entry, signal?: AbortSignal) => {
      const sources = await getEntryAttachmentSources(target, signal)
      if (signal?.aborted) return
      setAttachments(buildPreviews(sources.serverAttachments, sources.pending))
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
          await load(entry)
          if (isStale()) return
          const summary = await drainOutbox()
          if (isStale()) return
          if (summary.processed > 0) {
            await load(entry)
            if (isStale()) return
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
        } catch {
          if (!isStale()) setStatus({ tone: 'error', message: "Couldn't queue that photo. Try again." })
        } finally {
          if (!isStale()) setBusy(false)
        }
      })()
    },
    [entry, load, onAuthRequired, onAuthConfirmed],
  )

  return { attachments, busy, status, addPhoto }
}

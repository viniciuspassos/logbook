export type AdventureShape = 'circle' | 'triangle' | 'diamond'

/**
 * #26 type-revisit decision: `photoHint`/`media` below stay exactly what
 * they always were — AI/seed-derived *decorative* caption strings, rendered
 * via PhotoPlaceholder (see TimelineScreen/EntryDetailOverlay), never real
 * image bytes. They predate real photo attachments and this app has no
 * retroactive migration from one to the other.
 *
 * Real, uploaded attachments (#17/#26) are a deliberately separate concept
 * and do NOT get a field on `Entry`: they're fetched per-entry from the
 * backend (`ServerAttachment`, src/types/sync.ts) or, while still offline,
 * held in the outbox's write queue (`OutboxRecord`, src/types/outbox.ts) —
 * see useEntryAttachments.ts. This mirrors the server's own `Entry` entity
 * (server/src/entries/entry.entity.ts), which likewise has no attachments
 * column; attachments there are a separate table keyed by `entryId`. Keeping
 * them off this interface means every existing seed/local entry (none of
 * which have ever had attachments) needs no migration and no new optional
 * field — an entry simply has zero attachments until one is fetched or
 * queued for it.
 */
export interface Entry {
  id: number
  title: string
  shape: AdventureShape
  /**
   * Optional richer activity classification from the AI (e.g. "Skydiving",
   * "Climbing", "Hiking"). Additive to `shape`, which stays the 3-value icon
   * bucket; older seed entries may omit this.
   */
  activityType?: string
  location: string
  date: string
  metric: string
  excerpt: string
  weather: string
  duration: string
  difficulty: string
  equipment: string
  participants: string
  raw: string
  story: string
  photoHint: string
  media: [string, string, string]
  /** Percent position (0-100) on the timeline's map view. */
  mapX: number
  mapY: number
}

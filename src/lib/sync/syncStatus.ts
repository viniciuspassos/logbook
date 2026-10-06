import type { DrainSummary } from './outboxRunner.ts'

/**
 * The timeline header's sync line, from how the last outbox drain ended
 * (`null` = none has finished yet). Entries are always saved locally first,
 * so that part never changes; the suffix only claims what the drain proved —
 * "synced" means the queue is empty, not that every entry ever made is on
 * the server. No backend or no network reads as plain "Saved locally",
 * since the backend is optional (CLAUDE.md) and that's a normal state.
 */
export function syncStatusLabel(lastDrain: DrainSummary | null, syncOff = false): string {
  // The server has login off, so nothing is ever sent: say so rather than "synced".
  if (syncOff) return 'Saved locally · sync is off'
  switch (lastDrain?.stoppedReason) {
    case 'empty':
      return 'Saved locally · synced'
    case 'auth':
      return 'Saved locally · sign in to sync'
    case 'error':
      return 'Saved locally · sync failed'
    case 'rejected':
      return 'Saved locally · some changes rejected'
    default:
      return 'Saved locally'
  }
}

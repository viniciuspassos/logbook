import { syncStatusLabel } from './syncStatus.ts'
import type { DrainSummary } from './outboxRunner.ts'

describe('syncStatusLabel', () => {
  it.each<[DrainSummary | null, string]>([
    [null, 'Saved locally'],
    [{ processed: 0, stoppedReason: 'unsupported' }, 'Saved locally'],
    [{ processed: 0, stoppedReason: 'unreachable' }, 'Saved locally'],
    [{ processed: 0, stoppedReason: 'aborted' }, 'Saved locally'],
    [{ processed: 0, stoppedReason: 'empty' }, 'Saved locally · synced'],
    [{ processed: 2, stoppedReason: 'empty' }, 'Saved locally · synced'],
    [{ processed: 0, stoppedReason: 'auth' }, 'Saved locally · sign in to sync'],
    [{ processed: 1, stoppedReason: 'error', error: 'boom' }, 'Saved locally · sync failed'],
  ])('%j -> %s', (summary, label) => {
    expect(syncStatusLabel(summary)).toBe(label)
  })
})

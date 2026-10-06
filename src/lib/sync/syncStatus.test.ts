import { syncStatusLabel } from './syncStatus.ts'
import type { DrainSummary } from './outboxRunner.ts'

describe('syncStatusLabel', () => {
  it('says sync is off when the server has login off, whatever the last drain did', () => {
    expect(syncStatusLabel(null, true)).toBe('Saved locally · sync is off')
    expect(syncStatusLabel({ processed: 0, stoppedReason: 'auth' }, true)).toBe('Saved locally · sync is off')
    expect(syncStatusLabel({ processed: 1, stoppedReason: 'empty' }, true)).toBe('Saved locally · sync is off')
  })

  it('reads from the last drain when sync is on', () => {
    expect(syncStatusLabel({ processed: 1, stoppedReason: 'empty' }, false)).toBe('Saved locally · synced')
  })

  it.each<[DrainSummary | null, string]>([
    [null, 'Saved locally'],
    [{ processed: 0, stoppedReason: 'unsupported' }, 'Saved locally'],
    [{ processed: 0, stoppedReason: 'unreachable' }, 'Saved locally'],
    [{ processed: 0, stoppedReason: 'aborted' }, 'Saved locally'],
    [{ processed: 0, stoppedReason: 'empty' }, 'Saved locally · synced'],
    [{ processed: 2, stoppedReason: 'empty' }, 'Saved locally · synced'],
    [{ processed: 0, stoppedReason: 'auth' }, 'Saved locally · sign in to sync'],
    [{ processed: 1, stoppedReason: 'error', error: 'boom' }, 'Saved locally · sync failed'],
    [{ processed: 1, stoppedReason: 'rejected', error: 'File too large' }, 'Saved locally · some changes rejected'],
  ])('%j -> %s', (summary, label) => {
    expect(syncStatusLabel(summary)).toBe(label)
  })
})

/**
 * @jest-environment node
 */
// jsdom hard-codes `window` as a non-configurable global property, so it
// can't be deleted or shadowed from a jsdom test — the SSR/no-window branch
// in startAutoSync() can only be reached where `window` is genuinely absent.
// This file runs under Jest's plain `node` environment for that one case;
// every other outboxRunner.ts behaviour is covered under jsdom in
// outboxRunner.test.ts.
import { startAutoSync } from './outboxRunner.ts'

describe('startAutoSync (no window, e.g. SSR)', () => {
  it('is a no-op: returns a cleanup that does nothing and never touches window', () => {
    expect(typeof window).toBe('undefined')
    const stop = startAutoSync()
    expect(() => stop()).not.toThrow()
  })
})

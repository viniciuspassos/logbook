import { shouldUseMockData } from './mockData.ts'

describe('shouldUseMockData', () => {
  afterEach(() => {
    delete (globalThis as { __LOGBOOK_MOCKED__?: boolean }).__LOGBOOK_MOCKED__
  })

  it('defaults to false when the build-time flag was never set', () => {
    expect(shouldUseMockData()).toBe(false)
  })

  it('returns true once vite.config.ts has defined the flag as true (--mocked)', () => {
    ;(globalThis as { __LOGBOOK_MOCKED__?: boolean }).__LOGBOOK_MOCKED__ = true
    expect(shouldUseMockData()).toBe(true)
  })

  it('returns false when the flag was defined as false', () => {
    ;(globalThis as { __LOGBOOK_MOCKED__?: boolean }).__LOGBOOK_MOCKED__ = false
    expect(shouldUseMockData()).toBe(false)
  })
})

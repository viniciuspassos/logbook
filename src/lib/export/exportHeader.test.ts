import { entryCountLabel, formatExportDate } from './exportHeader.ts'

describe('formatExportDate', () => {
  it('formats as "Mon D, YYYY"', () => {
    expect(formatExportDate(new Date(2026, 6, 16))).toBe('Jul 16, 2026')
  })

  it('handles the first and last month of the year', () => {
    expect(formatExportDate(new Date(2026, 0, 1))).toBe('Jan 1, 2026')
    expect(formatExportDate(new Date(2026, 11, 31))).toBe('Dec 31, 2026')
  })
})

describe('entryCountLabel', () => {
  it.each([
    [0, '0 entries'],
    [1, '1 entry'],
    [2, '2 entries'],
  ])('labels %p as %p', (count, expected) => {
    expect(entryCountLabel(count)).toBe(expected)
  })
})

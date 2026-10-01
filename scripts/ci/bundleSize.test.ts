import { computeBundleSizeViolations, type BudgetConfig } from './bundleSize.ts'

describe('computeBundleSizeViolations', () => {
  const budget: BudgetConfig = {
    maxTotalJsBytes: 150000,
    maxTotalCssBytes: 50000,
    maxSingleJsChunkBytes: 80000,
  }

  it('returns no violations when all files are under budget', () => {
    const files = [
      { path: 'app.js', gzipBytes: 60000 },
      { path: 'vendor.js', gzipBytes: 70000 },
      { path: 'styles.css', gzipBytes: 40000 },
    ]
    expect(computeBundleSizeViolations(files, budget)).toEqual([])
  })

  it('detects total JS size violation', () => {
    const files = [
      { path: 'app.js', gzipBytes: 100000 },
      { path: 'vendor.js', gzipBytes: 70000 },
      { path: 'styles.css', gzipBytes: 40000 },
    ]
    const violations = computeBundleSizeViolations(files, budget)
    expect(violations).toContainEqual(expect.stringContaining('Total JS'))
    expect(violations).toContainEqual(expect.stringContaining('170000 bytes'))
  })

  it('detects total CSS size violation', () => {
    const files = [
      { path: 'app.js', gzipBytes: 60000 },
      { path: 'vendor.js', gzipBytes: 70000 },
      { path: 'styles.css', gzipBytes: 35000 },
      { path: 'dark.css', gzipBytes: 20000 },
    ]
    const violations = computeBundleSizeViolations(files, budget)
    expect(violations).toContainEqual(expect.stringContaining('Total CSS'))
    expect(violations).toContainEqual(expect.stringContaining('55000 bytes'))
  })

  it('detects single JS chunk size violation', () => {
    const files = [
      { path: 'app.js', gzipBytes: 100000 },
      { path: 'vendor.js', gzipBytes: 40000 },
      { path: 'styles.css', gzipBytes: 40000 },
    ]
    const violations = computeBundleSizeViolations(files, budget)
    expect(violations).toContainEqual(expect.stringContaining('app.js'))
    expect(violations).toContainEqual(expect.stringContaining('100000 bytes'))
  })

  it('reports multiple violations together', () => {
    const files = [
      { path: 'app.js', gzipBytes: 100000 },
      { path: 'vendor.js', gzipBytes: 80000 },
      { path: 'styles.css', gzipBytes: 55000 },
    ]
    const violations = computeBundleSizeViolations(files, budget)
    expect(violations.length).toBeGreaterThan(1)
    expect(violations.join('\n')).toMatch(/Total JS|Total CSS|app.js|vendor.js/)
  })

  it('ignores non-JS/CSS files', () => {
    const files = [
      { path: 'app.js', gzipBytes: 60000 },
      { path: 'vendor.js', gzipBytes: 70000 },
      { path: 'styles.css', gzipBytes: 40000 },
      { path: 'icon.png', gzipBytes: 100000 },
      { path: 'manifest.json', gzipBytes: 5000 },
    ]
    expect(computeBundleSizeViolations(files, budget)).toEqual([])
  })

  it('categorizes files by extension', () => {
    const files = [
      { path: 'app.js', gzipBytes: 80000 },
      { path: 'vendor.JS', gzipBytes: 70000 }, // uppercase variant
      { path: 'styles.css', gzipBytes: 30000 },
      { path: 'dark.CSS', gzipBytes: 15000 }, // uppercase variant
    ]
    // Should handle case-insensitive extensions
    const violations = computeBundleSizeViolations(files, budget)
    // Total JS is 150000 (at limit), total CSS is 45000 (under limit)
    expect(violations).toEqual([])
  })

  it('handles empty file list', () => {
    expect(computeBundleSizeViolations([], budget)).toEqual([])
  })

  it('calculates totals correctly with many files', () => {
    const files = [
      { path: 'chunk1.js', gzipBytes: 30000 },
      { path: 'chunk2.js', gzipBytes: 30000 },
      { path: 'chunk3.js', gzipBytes: 30000 },
      { path: 'chunk4.js', gzipBytes: 30000 },
      { path: 'chunk5.js', gzipBytes: 30000 },
      { path: 'base.css', gzipBytes: 25000 },
      { path: 'theme.css', gzipBytes: 25000 },
    ]
    const violations = computeBundleSizeViolations(files, budget)
    // Total JS: 150000 (at limit), total CSS: 50000 (at limit)
    // No single chunk exceeds 80000
    expect(violations).toEqual([])
  })
})

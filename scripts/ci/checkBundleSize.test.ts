/** @jest-environment node */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as bundleSizeModule from './bundleSize.ts'
import { main, walkDistAssets } from './checkBundleSize.ts'

describe('walkDistAssets', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bundle-size-test-'))
  })

  it('returns empty array if dist/assets does not exist', async () => {
    const nonExistent = join(tempDir, 'nonexistent', 'assets')
    const result = await walkDistAssets(nonExistent)
    expect(result).toEqual([])
  })

  it('walks nested directories and includes all JS/CSS files', async () => {
    const assetsDir = join(tempDir, 'assets')
    const nestedDir = join(assetsDir, 'nested', 'deep')

    // Create directories and files
    mkdirSync(nestedDir, { recursive: true })
    writeFileSync(join(assetsDir, 'app.js'), 'a'.repeat(100))
    writeFileSync(join(assetsDir, 'styles.css'), 'b'.repeat(50))
    writeFileSync(join(nestedDir, 'app.js'), 'c'.repeat(75))
    writeFileSync(join(assetsDir, 'vendor.js'), 'd'.repeat(150))
    writeFileSync(join(assetsDir, 'icon.png'), 'e'.repeat(1000))

    const result = await walkDistAssets(assetsDir)

    // Should include JS and CSS files only
    const jsFiles = result.filter((f) => f.path.endsWith('.js'))
    expect(jsFiles.length).toBeGreaterThan(0)

    // All files should have gzipBytes > 0
    result.forEach((f) => {
      expect(f.gzipBytes).toBeGreaterThan(0)
    })

    // PNG should not be included
    expect(result.find((f) => f.path.endsWith('.png'))).toBeUndefined()
  })

  it('ignores non-JS/CSS files', async () => {
    const assetsDir = join(tempDir, 'assets')
    mkdirSync(assetsDir, { recursive: true })

    writeFileSync(join(assetsDir, 'app.js'), 'a'.repeat(100))
    writeFileSync(join(assetsDir, 'manifest.json'), '{}')
    writeFileSync(join(assetsDir, 'icon.svg'), '<svg></svg>')
    writeFileSync(join(assetsDir, 'font.woff2'), 'f'.repeat(500))

    const result = await walkDistAssets(assetsDir)

    expect(result.length).toBe(1)
    expect(result[0].path).toContain('app.js')
  })

  it('handles case-insensitive extensions', async () => {
    const assetsDir = join(tempDir, 'assets')
    mkdirSync(assetsDir, { recursive: true })

    writeFileSync(join(assetsDir, 'app.JS'), 'a'.repeat(100))
    writeFileSync(join(assetsDir, 'styles.CSS'), 'b'.repeat(50))

    const result = await walkDistAssets(assetsDir)

    expect(result.length).toBe(2)
    const extensions = result.map((f) => f.path.split('.').pop()?.toUpperCase())
    expect(extensions).toContainEqual('JS')
    expect(extensions).toContainEqual('CSS')
  })

  it('computes correct gzip sizes', async () => {
    const assetsDir = join(tempDir, 'assets')
    mkdirSync(assetsDir, { recursive: true })

    // Write a compressible file (gzip should significantly reduce it)
    writeFileSync(join(assetsDir, 'app.js'), 'a'.repeat(10000))

    const result = await walkDistAssets(assetsDir)

    expect(result.length).toBe(1)
    // Highly repetitive content should gzip to much smaller than 10000 bytes
    expect(result[0].gzipBytes).toBeLessThan(10000)
    expect(result[0].gzipBytes).toBeGreaterThan(0)
  })
})

describe('main', () => {
  let tempDir: string
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bundle-size-test-'))
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns 1 if dist/assets does not exist', async () => {
    const result = await main(join(tempDir, 'nonexistent'))
    expect(result).toBe(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('::error::'))
    expect(consoleErrorSpy.mock.calls[0][0]).toContain('dist/assets')
  })

  it('returns 0 when all files are under budget', async () => {
    const assetsDir = join(tempDir, 'assets')
    mkdirSync(assetsDir, { recursive: true })
    writeFileSync(join(assetsDir, 'app.js'), 'a'.repeat(50000))
    writeFileSync(join(assetsDir, 'styles.css'), 'b'.repeat(20000))

    const result = await main(tempDir)
    expect(result).toBe(0)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('prints a table of files with sizes in KiB', async () => {
    const assetsDir = join(tempDir, 'assets')
    mkdirSync(assetsDir, { recursive: true })
    writeFileSync(join(assetsDir, 'app.js'), 'a'.repeat(50000))
    writeFileSync(join(assetsDir, 'styles.css'), 'b'.repeat(20000))

    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

    await main(tempDir)

    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('File')
    expect(output).toContain('Size (KiB)')

    consoleLogSpy.mockRestore()
  })

  it('reports total KiB for all files', async () => {
    const assetsDir = join(tempDir, 'assets')
    mkdirSync(assetsDir, { recursive: true })
    writeFileSync(join(assetsDir, 'app.js'), 'a'.repeat(50000))
    writeFileSync(join(assetsDir, 'styles.css'), 'b'.repeat(20000))

    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

    await main(tempDir)

    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('Total')
    expect(output).toContain('KiB')

    consoleLogSpy.mockRestore()
  })

  it('returns 1 when no JS/CSS files are found', async () => {
    const assetsDir = join(tempDir, 'assets')
    mkdirSync(assetsDir, { recursive: true })
    writeFileSync(join(assetsDir, 'icon.png'), 'data')
    writeFileSync(join(assetsDir, 'manifest.json'), '{}')

    const result = await main(tempDir)
    expect(result).toBe(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('No .js or .css files found'),
    )
  })

  it('returns 1 when dist directory access fails', async () => {
    const result = await main('/nonexistent/path/to/dist')
    expect(result).toBe(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('::error::'))
  })

  it('reports and returns 1 when violations are found', async () => {
    const assetsDir = join(tempDir, 'assets')
    mkdirSync(assetsDir, { recursive: true })
    writeFileSync(join(assetsDir, 'app.js'), 'a'.repeat(50000))

    // Mock computeBundleSizeViolations to return violations
    const spyCompute = jest
      .spyOn(bundleSizeModule, 'computeBundleSizeViolations')
      .mockReturnValue(['Total JS: 100000 bytes exceeds budget of 90000 bytes'])

    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

    const result = await main(tempDir)

    expect(result).toBe(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Total JS: 100000 bytes exceeds budget'),
    )

    spyCompute.mockRestore()
    consoleLogSpy.mockRestore()
  })
})

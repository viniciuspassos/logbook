// Invoked through scripts/ci/runBundleSize.ts (no logic there, so this stays testable).
import { gzipSync } from 'node:zlib'
import { promises as fs } from 'node:fs'
import { join, basename } from 'node:path'
import { computeBundleSizeViolations, BUNDLE_BUDGET, type BundleFile } from './bundleSize.ts'

/**
 * Walk dist/assets recursively and compute gzip sizes for all .js and .css files.
 * @returns Array of files with their gzipped sizes in bytes. Empty array if dist/assets does not exist.
 */
export async function walkDistAssets(assetsDir: string): Promise<BundleFile[]> {
  const files: BundleFile[] = []

  async function processFile(fullPath: string, fileName: string): Promise<void> {
    const ext = fileName.toLowerCase().split('.').pop()
    if (ext !== 'js' && ext !== 'css') return
    const content = await fs.readFile(fullPath)
    const gzipBytes = gzipSync(content).length
    files.push({
      path: basename(fullPath),
      gzipBytes,
    })
  }

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile()) {
        await processFile(fullPath, entry.name)
      }
    }
  }

  try {
    await walk(assetsDir)
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return []
    }
    throw error
  }

  return files
}

function formatTableRow(file: string, kb: number): string {
  return `${file.padEnd(40)} ${kb.toFixed(1).padStart(8)} KiB`
}

function toKb(bytes: number): number {
  return bytes / 1024
}

export async function main(distDir: string): Promise<number> {
  const assetsDir = join(distDir, 'assets')

  // Check if dist/assets exists
  try {
    await fs.access(assetsDir)
  } catch {
    console.error(
      `::error::dist/assets not found at ${assetsDir} — did you run \`npm run build\`?`,
    )
    return 1
  }

  try {
    const files = await walkDistAssets(assetsDir)

    if (files.length === 0) {
      console.error('::error::No .js or .css files found in dist/assets.')
      return 1
    }

    // Sort by size descending for readability
    const sorted = [...files].sort((a, b) => b.gzipBytes - a.gzipBytes)

    // Print table header
    console.log()
    console.log('File'.padEnd(40) + ' Size (KiB)')
    console.log('-'.repeat(50))

    // Print each file
    let totalBytes = 0
    for (const file of sorted) {
      console.log(formatTableRow(file.path, toKb(file.gzipBytes)))
      totalBytes += file.gzipBytes
    }

    // Print total
    console.log('-'.repeat(50))
    console.log(formatTableRow('Total', toKb(totalBytes)))
    console.log()

    // Check for violations
    const violations = computeBundleSizeViolations(files, BUNDLE_BUDGET)

    if (violations.length > 0) {
      violations.forEach((v) => console.error(`::error::${v}`))
      return 1
    }

    return 0
  } catch (error) {
    console.error(`::error::Bundle size check failed: ${String(error)}`)
    return 1
  }
}

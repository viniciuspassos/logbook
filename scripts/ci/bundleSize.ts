// Pure rules for the frontend bundle size CI gate (see .github/workflows/ci-bundle-size.yml).
// Kept free of I/O so every rule is unit-testable; checkBundleSize.ts does the file walking.

export interface BudgetConfig {
  /** Maximum total gzip size (in bytes) for all .js files under dist/assets. */
  maxTotalJsBytes: number
  /** Maximum total gzip size (in bytes) for all .css files under dist/assets. */
  maxTotalCssBytes: number
  /** Maximum gzip size (in bytes) for the largest single .js chunk. */
  maxSingleJsChunkBytes: number
}

export interface BundleFile {
  path: string
  gzipBytes: number
}

/**
 * Validate bundle sizes against a budget.
 * @returns Array of violation messages if any budget is exceeded, empty array otherwise.
 *
 * Budget rationale (as of Oct 2026, measured at build time, adjusted +12% and rounded up):
 * - Total JS: baseline 77777 bytes → 89088 bytes (87 KiB; largest chunks grow as features are added)
 * - Total CSS: baseline 5279 bytes → 6144 bytes (6 KiB; theme tokens + component styles); raised to 7168 bytes (7 KiB) for the sign-in screen (see below)
 * - Single JS chunk: baseline 77777 bytes → 89088 bytes (87 KiB; prevents any one chunk runaway)
 *
 * To raise the budget: run `npm ci && npm run build`, measure gzip sizes with your own
 * script (e.g. `node -e "const zlib=require('zlib'),fs=require('fs');const content=fs.readFileSync('dist/assets/file.js');console.log(zlib.gzipSync(content).length);"`),
 * note the totals in bytes, update these constants with a comment explaining why (new feature, refactor,
 * etc.), and include measured sizes in the PR description.
 */
export const BUNDLE_BUDGET: BudgetConfig = {
  // Measured Oct 2026: 77777 bytes + 12% = 87110 bytes, rounded to 87 KiB (89088 bytes)
  maxTotalJsBytes: 89088,
  // Measured Oct 2026: 5279 bytes + 12% = 5913 bytes, rounded to 6 KiB (6144 bytes).
  // Raised for Sign in with Google (#122): the login screen, its contour-line art, the
  // sign-in banner and the account row added ~1.3 KiB gzip of CSS (6548 bytes measured with
  // the feature) + 12% = 7334 bytes, rounded down to 7 KiB (7168 bytes) to keep the headroom small.
  maxTotalCssBytes: 7168,
  // Measured Oct 2026: 77777 bytes (single file) + 12% = 87110 bytes, rounded to 87 KiB (89088 bytes)
  maxSingleJsChunkBytes: 89088,
}

export function computeBundleSizeViolations(files: BundleFile[], budget: BudgetConfig): string[] {
  const violations: string[] = []

  const jsFiles = files.filter((f) => f.path.toLowerCase().endsWith('.js'))
  const cssFiles = files.filter((f) => f.path.toLowerCase().endsWith('.css'))

  const totalJsBytes = jsFiles.reduce((sum, f) => sum + f.gzipBytes, 0)
  if (totalJsBytes > budget.maxTotalJsBytes) {
    violations.push(
      `Total JS: ${totalJsBytes} bytes exceeds budget of ${budget.maxTotalJsBytes} bytes`,
    )
  }

  const totalCssBytes = cssFiles.reduce((sum, f) => sum + f.gzipBytes, 0)
  if (totalCssBytes > budget.maxTotalCssBytes) {
    violations.push(
      `Total CSS: ${totalCssBytes} bytes exceeds budget of ${budget.maxTotalCssBytes} bytes`,
    )
  }

  if (jsFiles.length > 0) {
    const largestJs = jsFiles.reduce((max, f) => (f.gzipBytes > max.gzipBytes ? f : max))
    if (largestJs.gzipBytes > budget.maxSingleJsChunkBytes) {
      violations.push(
        `Largest JS chunk (${largestJs.path}): ${largestJs.gzipBytes} bytes exceeds budget of ${budget.maxSingleJsChunkBytes} bytes`,
      )
    }
  }

  return violations
}

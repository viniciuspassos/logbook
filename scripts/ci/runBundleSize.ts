// Thin executable wrapper, run by .github/workflows/ci-bundle-size.yml:
//   node scripts/ci/runBundleSize.ts
// All logic lives (and is tested) in checkBundleSize.ts.
import { main } from './checkBundleSize.ts'

process.exitCode = await main('dist')

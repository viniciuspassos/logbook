// Thin executable wrapper, run by .github/workflows/ci-pr-hygiene.yml:
//   node scripts/ci/runCheckPrMetadata.ts
// All logic lives (and is tested) in checkPrMetadata.ts.
import { main } from './checkPrMetadata.ts'

process.exitCode = await main(process.env)

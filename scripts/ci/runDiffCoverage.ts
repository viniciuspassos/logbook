// Thin executable wrapper, run by the *-diff-coverage jobs in .github/workflows/ci-static.yml:
//   node scripts/ci/runDiffCoverage.ts --coverage coverage/coverage-final.json --prefix src/
// All logic lives (and is tested) in diffCoverage.ts.
import { main } from './diffCoverage.ts'

process.exitCode = main(process.argv.slice(2))

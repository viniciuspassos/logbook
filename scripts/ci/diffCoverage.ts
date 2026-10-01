// Diff-aware coverage gate: every function a PR touched must be executed by a test.
// 1) `git diff -U0` -> changed lines per file, 2) TypeScript AST -> functions containing
// those lines, 3) Jest's istanbul coverage-final.json -> were they hit? (3 lives in coverageMatch.ts.)
// Invoked through scripts/ci/runDiffCoverage.ts (no logic there, so this stays testable).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs as parseNodeArgs } from 'node:util'
import { parseChangedLines } from './changedLines.ts'
import {
  assertCoverageUnderRoot,
  evaluateFile,
  formatFinding,
  isGatedFile,
  parseCoverage,
  type CoverageMap,
  type Finding,
} from './coverageMatch.ts'

export interface Options {
  coveragePath: string
  base: string
  /** Repo-relative directory prefixes whose changes are gated, e.g. ["src/"]. */
  prefixes: string[]
  repoRoot: string
}

export interface Report {
  findings: Finding[]
  /** Gated files with modified functions that are absent from the coverage report. */
  unchecked: string[]
  modifiedFunctions: number
  filesChecked: number
}

/**
 * Hooks run by git (pre-commit, pre-push) export GIT_DIR / GIT_INDEX_FILE, which override
 * `cwd` and would point our git calls at whatever repo the hook belongs to.
 */
export function cleanGitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('GIT_')))
}

/** Diff of the working tree against the merge base with `base` — identical to base...HEAD in CI. */
export function readDiff(base: string, repoRoot: string): string {
  const args = [
    '-c', 'core.quotePath=false',
    'diff', '--merge-base', base,
    '-U0', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--diff-filter=ACMR',
  ]
  return execFileSync('git', args, {
    cwd: repoRoot,
    env: cleanGitEnv(process.env),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

export function collectReport(diff: string, coverage: CoverageMap, opts: Options): Report {
  const report: Report = { findings: [], unchecked: [], modifiedFunctions: 0, filesChecked: 0 }
  for (const [file, changed] of parseChangedLines(diff)) {
    const absolute = join(opts.repoRoot, file)
    if (!isGatedFile(file, opts.prefixes) || !existsSync(absolute)) continue
    const result = evaluateFile(file, readFileSync(absolute, 'utf8'), changed, coverage[absolute])
    report.modifiedFunctions += result.modified
    report.findings.push(...result.findings)
    if (result.unchecked) report.unchecked.push(file)
    else if (result.modified > 0) report.filesChecked++
  }
  return report
}

export function parseArgs(argv: string[]): Options {
  const { values } = parseNodeArgs({
    args: argv,
    strict: true,
    options: {
      coverage: { type: 'string' },
      prefix: { type: 'string', multiple: true },
      base: { type: 'string' },
      root: { type: 'string' },
    },
  })
  if (!values.coverage || !values.prefix?.length) {
    throw new Error('usage: --coverage <coverage-final.json> --prefix <dir/> [--prefix ...] [--base <ref>]')
  }
  return {
    coveragePath: values.coverage,
    prefixes: values.prefix,
    base: values.base ?? 'origin/main',
    repoRoot: values.root ?? process.cwd(),
  }
}

export function main(argv: string[]): number {
  try {
    const opts = parseArgs(argv)
    const coverage = parseCoverage(JSON.parse(readFileSync(opts.coveragePath, 'utf8')))
    assertCoverageUnderRoot(coverage, opts.repoRoot)
    const report = collectReport(readDiff(opts.base, opts.repoRoot), coverage, opts)
    report.findings.forEach((finding) => console.error(formatFinding(finding)))
    report.unchecked.forEach((file) =>
      console.warn(`::warning file=${file}::Modified functions here are not in the coverage report (excluded from collectCoverageFrom?), so they were not checked.`),
    )
    console.log(
      `Diff coverage: ${report.modifiedFunctions} modified function(s) in ${report.filesChecked} file(s) checked, ${report.findings.length} problem(s).`,
    )
    return report.findings.length === 0 ? 0 : 1
  } catch (error) {
    console.error(`::error::Diff coverage check could not run: ${String(error)}`)
    return 1
  }
}

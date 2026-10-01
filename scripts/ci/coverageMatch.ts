// Pure half of the diff-coverage gate: given a file's source, its changed lines and Jest's
// istanbul coverage entry, decide which modified functions no test executes. No I/O here;
// diffCoverage.ts reads git and the coverage file and calls into this.
import { findFunctions, modifiedFunctions, type FnSpan } from './functionSpans.ts'

interface IstanbulFn {
  decl: { start: { line: number; column: number } }
  loc: { end: { line: number } }
}

export interface CoverageFile {
  fnMap: Record<string, IstanbulFn>
  f: Record<string, number>
}

export type CoverageMap = Record<string, CoverageFile>

export interface Finding {
  file: string
  fn: FnSpan
  reason: 'uncovered' | 'no-coverage-data'
}

export interface FileResult {
  /** Functions the diff modified in this file. */
  modified: number
  findings: Finding[]
  /** Modified functions exist but the file is absent from the coverage report, so none were checked. */
  unchecked: boolean
}

// istanbul's `decl` is the function's name line (arrow/expression: its own start) and its `loc`
// is the *body*, so for a parenthesised expression-bodied arrow (`x: () => (\n <jsx/>\n)`) loc
// ends before the closing `)` the AST includes. The start line must match exactly; the end line
// may be a little short.
const END_LINE_TOLERANCE = 2

const SKIPPED_FILE = /(\.test\.tsx?|\.d\.ts)$/

export function isGatedFile(path: string, prefixes: string[]): boolean {
  return /\.tsx?$/.test(path) && !SKIPPED_FILE.test(path) && prefixes.some((p) => path.startsWith(p))
}

/**
 * Hit count of the istanbul function matching this span, or undefined when none matches.
 * Functions starting on the same line (two JSX handlers, a callback in a one-line component)
 * are told apart by the column of their start.
 */
export function hitCount(span: FnSpan, file: CoverageFile): number | undefined {
  let best: { score: number; hits: number } | undefined
  for (const [id, entry] of Object.entries(file.fnMap)) {
    const endDistance = span.endLine - entry.loc.end.line
    if (entry.decl.start.line !== span.startLine || endDistance < 0 || endDistance > END_LINE_TOLERANCE) continue
    const score = Math.abs(entry.decl.start.column - span.startColumn) * 10 + endDistance
    if (!best || score < best.score) best = { score, hits: file.f[id] ?? 0 }
  }
  return best?.hits
}

export function evaluateFile(
  file: string,
  source: string,
  changed: Set<number>,
  coverage: CoverageFile | undefined,
): FileResult {
  const touched = modifiedFunctions(findFunctions(source, file), changed)
  if (!coverage) return { modified: touched.length, findings: [], unchecked: touched.length > 0 }
  const findings: Finding[] = []
  for (const fn of touched) {
    const hits = hitCount(fn, coverage)
    if (hits === undefined) findings.push({ file, fn, reason: 'no-coverage-data' })
    else if (hits === 0) findings.push({ file, fn, reason: 'uncovered' })
  }
  return { modified: touched.length, findings, unchecked: false }
}

export function formatFinding({ file, fn, reason }: Finding): string {
  const why =
    reason === 'uncovered'
      ? 'was modified but no test executes it'
      : 'was modified but has no entry in the coverage report'
  return `::error file=${file},line=${fn.startLine}::Function '${fn.name}' ${why}. Add or update its unit test.`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function at(value: unknown, ...keys: string[]): unknown {
  let current = value
  for (const key of keys) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}

function toIstanbulFn(path: string, id: string, value: unknown): IstanbulFn {
  const line = at(value, 'decl', 'start', 'line')
  const column = at(value, 'decl', 'start', 'column')
  const endLine = at(value, 'loc', 'end', 'line')
  if (!isCount(line) || !isCount(column) || !isCount(endLine)) {
    throw new Error(`coverage entry for ${path} has a malformed fnMap[${id}]`)
  }
  return { decl: { start: { line, column } }, loc: { end: { line: endLine } } }
}

function toCoverageFile(path: string, value: unknown): CoverageFile {
  if (!isRecord(value) || !isRecord(value.fnMap) || !isRecord(value.f)) {
    throw new Error(`coverage entry for ${path} has no fnMap/f`)
  }
  const fnMap: CoverageFile['fnMap'] = {}
  for (const [id, entry] of Object.entries(value.fnMap)) fnMap[id] = toIstanbulFn(path, id, entry)
  const f: CoverageFile['f'] = {}
  for (const [id, hits] of Object.entries(value.f)) {
    if (!isCount(hits)) throw new Error(`coverage entry for ${path} has a non-numeric hit count f[${id}]`)
    f[id] = hits
  }
  return { fnMap, f }
}

/** Validates istanbul's coverage-final.json shape, returning a typed copy. */
export function parseCoverage(json: unknown): CoverageMap {
  if (!isRecord(json)) throw new Error('coverage file is not an object')
  return Object.fromEntries(Object.entries(json).map(([path, file]) => [path, toCoverageFile(path, file)]))
}

/**
 * Coverage keys are absolute paths; if none sit under the repo root the file lookups would all
 * miss and the gate would silently check nothing (wrong cwd, symlinked checkout, moved rootDir).
 */
export function assertCoverageUnderRoot(coverage: CoverageMap, repoRoot: string): void {
  const paths = Object.keys(coverage)
  if (paths.length > 0 && !paths.some((p) => p.startsWith(repoRoot))) {
    throw new Error(`no coverage entry is under the repo root ${repoRoot} (e.g. ${paths[0]})`)
  }
}

/** @jest-environment node */
import {
  assertCoverageUnderRoot,
  evaluateFile,
  formatFinding,
  hitCount,
  isGatedFile,
  parseCoverage,
  type CoverageFile,
} from './coverageMatch.ts'
import type { FnSpan } from './functionSpans.ts'

const entry = (line: number, end: number, column = 0) => ({
  decl: { start: { line, column } },
  loc: { end: { line: end } },
})
const span = (startLine: number, endLine: number, startColumn = 0, name = 'fn'): FnSpan => ({
  name,
  startLine,
  startColumn,
  endLine,
  firstLine: startLine,
})

describe('isGatedFile', () => {
  it.each([
    ['src/a.ts', true],
    ['src/ui/B.tsx', true],
    ['src/a.test.ts', false],
    ['src/x.d.ts', false],
    ['docs/a.ts', false],
    ['src/readme.md', false],
  ])('%s -> %s', (path, expected) => {
    expect(isGatedFile(path, ['src/'])).toBe(expected)
  })
})

describe('hitCount', () => {
  const file: CoverageFile = { fnMap: { 0: entry(10, 20), 1: entry(40, 45) }, f: { 0: 5, 1: 0 } }

  it('matches on the exact start line and the end line', () => {
    expect(hitCount(span(10, 20), file)).toBe(5)
    expect(hitCount(span(40, 45), file)).toBe(0)
  })

  it('never borrows a neighbouring start line (fail closed)', () => {
    expect(hitCount(span(11, 20), file)).toBeUndefined()
    expect(hitCount(span(39, 45), file)).toBeUndefined()
  })

  it('accepts a body-only loc that ends before the closing paren of an arrow', () => {
    expect(hitCount(span(22, 24), { fnMap: { 0: entry(22, 23) }, f: { 0: 4 } })).toBe(4)
  })

  it('rejects entries that end far before, or after, the span', () => {
    expect(hitCount(span(22, 24), { fnMap: { 0: entry(22, 20) }, f: { 0: 4 } })).toBeUndefined()
    expect(hitCount(span(22, 24), { fnMap: { 0: entry(22, 25) }, f: { 0: 4 } })).toBeUndefined()
  })

  it('tells functions that start on the same line apart by column', () => {
    const sameLine: CoverageFile = { fnMap: { 0: entry(5, 5, 15), 1: entry(5, 5, 27) }, f: { 0: 3, 1: 0 } }
    expect(hitCount(span(5, 5, 15), sameLine)).toBe(3)
    expect(hitCount(span(5, 5, 27), sameLine)).toBe(0)
  })

  it('treats a missing hit entry as zero', () => {
    expect(hitCount(span(1, 2), { fnMap: { 9: entry(1, 2) }, f: {} })).toBe(0)
  })
})

describe('evaluateFile', () => {
  const source = 'export function a() {\n  return 1\n}\nexport function b() {\n  return 2\n}\n'
  const coverage: CoverageFile = { fnMap: { 0: entry(1, 3, 16), 1: entry(4, 6, 16) }, f: { 0: 1, 1: 0 } }

  it('flags a modified function that no test executes', () => {
    const result = evaluateFile('src/m.ts', source, new Set([5]), coverage)
    expect(result.modified).toBe(1)
    expect(result.findings).toMatchObject([{ file: 'src/m.ts', fn: { name: 'b' }, reason: 'uncovered' }])
  })

  it('passes a modified function that is covered and ignores untouched ones', () => {
    expect(evaluateFile('src/m.ts', source, new Set([2]), coverage)).toEqual({ modified: 1, findings: [], unchecked: false })
  })

  it('flags a modified function missing from the coverage report', () => {
    const result = evaluateFile('src/m.ts', source, new Set([2]), { fnMap: {}, f: {} })
    expect(result.findings[0].reason).toBe('no-coverage-data')
  })

  it('reports modified functions in a file absent from the coverage report as unchecked', () => {
    expect(evaluateFile('src/types.ts', source, new Set([2, 5]), undefined)).toEqual({
      modified: 2,
      findings: [],
      unchecked: true,
    })
  })

  it('is quiet for a file absent from the report when no function was modified', () => {
    expect(evaluateFile('src/types.ts', source, new Set([99]), undefined)).toEqual({
      modified: 0,
      findings: [],
      unchecked: false,
    })
  })
})

describe('formatFinding', () => {
  it('emits an annotation for each reason', () => {
    expect(formatFinding({ file: 'src/m.ts', fn: span(4, 6, 0, 'b'), reason: 'uncovered' })).toBe(
      "::error file=src/m.ts,line=4::Function 'b' was modified but no test executes it. Add or update its unit test.",
    )
    expect(formatFinding({ file: 'src/m.ts', fn: span(4, 6), reason: 'no-coverage-data' })).toMatch(
      /no entry in the coverage report/,
    )
  })
})

describe('parseCoverage', () => {
  const valid = { '/a.ts': { fnMap: { 0: entry(1, 2, 3) }, f: { 0: 4 } } }

  it('accepts the istanbul shape and returns a typed copy', () => {
    const parsed = parseCoverage({ '/a.ts': { ...valid['/a.ts'], statementMap: {} } })
    expect(parsed).toEqual(valid)
  })

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['a null entry', { '/a.ts': null }],
    ['missing f', { '/a.ts': { fnMap: {} } }],
    ['a malformed fnMap entry', { '/a.ts': { fnMap: { 0: { decl: {} } }, f: {} } }],
    ['a fnMap entry that is not an object', { '/a.ts': { fnMap: { 0: 5 }, f: {} } }],
    ['a string hit count', { '/a.ts': { fnMap: {}, f: { 0: '0' } } }],
    ['a negative hit count', { '/a.ts': { fnMap: {}, f: { 0: -1 } } }],
  ])('rejects %s', (_name, json) => {
    expect(() => parseCoverage(json)).toThrow()
  })
})

describe('assertCoverageUnderRoot', () => {
  it('passes when any entry is under the root, or the report is empty', () => {
    expect(() => assertCoverageUnderRoot({ '/repo/src/a.ts': { fnMap: {}, f: {} } }, '/repo')).not.toThrow()
    expect(() => assertCoverageUnderRoot({}, '/repo')).not.toThrow()
  })

  it('throws when no entry lives under the root (the gate would check nothing)', () => {
    expect(() => assertCoverageUnderRoot({ '/other/src/a.ts': { fnMap: {}, f: {} } }, '/repo')).toThrow('repo root')
  })
})

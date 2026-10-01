/** @jest-environment node */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanGitEnv, collectReport, main, parseArgs, readDiff } from './diffCoverage.ts'
import type { CoverageMap } from './coverageMatch.ts'

const entry = (line: number, end: number, column = 0) => ({
  decl: { start: { line, column } },
  loc: { end: { line: end } },
})

describe('cleanGitEnv', () => {
  it('drops every GIT_* variable and keeps the rest', () => {
    const cleaned = cleanGitEnv({ GIT_DIR: '/x', GIT_INDEX_FILE: '/y', PATH: '/bin', HOME: '/h' })
    expect(cleaned).toEqual({ PATH: '/bin', HOME: '/h' })
  })
})

describe('parseArgs', () => {
  it('reads flags, repeated prefixes and defaults', () => {
    const opts = parseArgs(['--coverage', 'c.json', '--prefix', 'src/', '--prefix', 'scripts/'])
    expect(opts).toMatchObject({ coveragePath: 'c.json', prefixes: ['src/', 'scripts/'], base: 'origin/main' })
    expect(opts.repoRoot).toBe(process.cwd())
  })

  it('accepts an explicit base and root', () => {
    expect(parseArgs(['--coverage', 'c', '--prefix', 'p/', '--base', 'x', '--root', '/r'])).toMatchObject({
      base: 'x',
      repoRoot: '/r',
    })
  })

  it.each([
    ['no prefix', ['--coverage', 'c']],
    ['no coverage', ['--prefix', 'src/']],
    ['an unknown flag', ['--coverage', 'c', '--prefix', 'p/', '--bse', 'x']],
    ['a flag without a value', ['--coverage', 'c', '--prefix']],
  ])('throws on %s', (_name, argv) => {
    expect(() => parseArgs(argv)).toThrow()
  })
})

describe('against real temporary git repos', () => {
  const dirs: string[] = []
  const tmp = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'diff-cov-'))
    dirs.push(dir)
    return dir
  }
  // Never let a surrounding hook's GIT_DIR / GIT_INDEX_FILE (set when this suite runs from a
  // pre-commit hook inside a linked worktree) redirect these calls to the real repository.
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
      { cwd, encoding: 'utf8', env: cleanGitEnv(process.env) },
    )

  const v1 = 'export function covered() {\n  return 1\n}\nexport function uncovered() {\n  return 2\n}\n'

  function makeRepo(v2: string, coverageFor: (abs: string) => CoverageMap): { dir: string; coverage: string } {
    const dir = tmp()
    git(dir, 'init', '-q')
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src/a.ts'), v1)
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'base')
    writeFileSync(join(dir, 'src/a.ts'), v2)
    git(dir, 'commit', '-qam', 'change')
    const coverage = join(dir, 'coverage.json')
    writeFileSync(coverage, JSON.stringify(coverageFor(join(dir, 'src/a.ts'))))
    return { dir, coverage }
  }

  const coverageMap = (abs: string): CoverageMap => ({
    [abs]: { fnMap: { 0: entry(1, 3, 16), 1: entry(4, 6, 16) }, f: { 0: 1, 1: 0 } },
  })
  const run = (dir: string, coverage: string) =>
    main(['--coverage', coverage, '--prefix', 'src/', '--base', 'HEAD~1', '--root', dir])

  let errorSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance
  let logSpy: jest.SpyInstance
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })
  afterEach(() => {
    jest.restoreAllMocks()
    dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  })

  it('readDiff returns the diff between the merge base and the working tree', () => {
    const { dir } = makeRepo(v1.replace('return 2', 'return 3'), coverageMap)
    expect(readDiff('HEAD~1', dir)).toContain('+  return 3')
    writeFileSync(join(dir, 'src/a.ts'), v1.replace('return 2', 'return 4'))
    expect(readDiff('HEAD~1', dir)).toContain('+  return 4')
  })

  it('fails when a modified function has no test coverage', () => {
    const { dir, coverage } = makeRepo(v1.replace('return 2', 'return 3'), coverageMap)
    expect(run(dir, coverage)).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Function 'uncovered'"))
  })

  it('passes when only covered functions were modified and prints a summary', () => {
    const { dir, coverage } = makeRepo(v1.replace('return 1', 'return 9'), coverageMap)
    expect(run(dir, coverage)).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 modified function(s) in 1 file(s) checked'))
  })

  it('warns, but does not fail, for modified functions in files missing from the coverage report', () => {
    const { dir, coverage } = makeRepo(v1.replace('return 2', 'return 3'), (abs) => ({
      [abs.replace('a.ts', 'other.ts')]: { fnMap: {}, f: {} }, // under the root, but not a.ts
    }))
    expect(run(dir, coverage)).toBe(0)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('::warning file=src/a.ts'))
  })

  it('ignores changed files outside the gated prefixes and files deleted from the tree', () => {
    const { dir } = makeRepo(`${v1}// trailing comment\n`, coverageMap)
    const diff = 'diff --git a/docs/x.ts b/docs/x.ts\n+++ b/docs/x.ts\n@@ -1 +1 @@\n' +
      'diff --git a/src/gone.ts b/src/gone.ts\n+++ b/src/gone.ts\n@@ -1 +1 @@\n'
    const opts = { coveragePath: '', base: 'HEAD~1', prefixes: ['src/'], repoRoot: dir }
    expect(collectReport(diff, {}, opts)).toEqual({ findings: [], unchecked: [], modifiedFunctions: 0, filesChecked: 0 })
  })

  it('does not touch the surrounding repository when GIT_DIR / GIT_INDEX_FILE are exported (hook env)', () => {
    const { dir, coverage } = makeRepo(v1.replace('return 2', 'return 3'), coverageMap)
    const decoy = tmp()
    git(decoy, 'init', '-q')
    const before = git(decoy, 'rev-parse', '--git-dir')
    const saved = { dir: process.env.GIT_DIR, index: process.env.GIT_INDEX_FILE }
    process.env.GIT_DIR = join(decoy, '.git')
    process.env.GIT_INDEX_FILE = join(decoy, '.git', 'index')
    try {
      expect(run(dir, coverage)).toBe(1) // still diffs the temp repo, not the decoy
    } finally {
      restoreEnv('GIT_DIR', saved.dir)
      restoreEnv('GIT_INDEX_FILE', saved.index)
    }
    expect(git(decoy, 'rev-parse', '--git-dir')).toBe(before)
    expect(git(decoy, 'rev-list', '--all', '--count').trim()).toBe('0')
  })

  it.each([
    ['the coverage file cannot be read', (dir: string) => ['--coverage', join(dir, 'missing.json')], /could not run/],
    ['an argument is unknown', (dir: string) => ['--coverage', join(dir, 'coverage.json'), '--bse', 'x'], /could not run/],
  ])('fails closed with an annotation when %s', (_name, extra, message) => {
    const { dir } = makeRepo(`${v1}// trailing comment\n`, coverageMap)
    expect(main([...extra(dir), '--prefix', 'src/', '--base', 'HEAD~1', '--root', dir])).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(message))
  })

  it('fails when no coverage entry lives under the repo root (the gate would check nothing)', () => {
    const { dir, coverage } = makeRepo(v1.replace('return 2', 'return 3'), () => ({
      '/somewhere/else/src/a.ts': { fnMap: {}, f: {} },
    }))
    expect(run(dir, coverage)).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('repo root'))
  })
})

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

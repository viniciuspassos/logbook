/** @jest-environment node */
// Runs the real .githooks/pre-push in a throwaway repo, with stub `npm`/`node` binaries that log
// their working directory and arguments, to check which gates run (and that a failing gate
// aborts the push). One test goes through a real `git push` and core.hooksPath.
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanGitEnv } from './diffCoverage.ts'

const HOOK = join(__dirname, '..', '..', '.githooks', 'pre-push')
const ZERO40 = '0'.repeat(40)
const ZERO64 = '0'.repeat(64)

// `node -p ...` (the hook's version probe) is answered but not logged.
const STUB = [
  '#!/bin/sh',
  'case "$(basename "$0") $1" in "node -p") echo "${STUB_NODE_VERSION:-24.0.0}"; exit 0;; esac',
  'echo "$(basename "$PWD"): $(basename "$0") $*" >> "$CALL_LOG"',
  'case "$*" in *"$FAIL_ON"*) [ -n "$FAIL_ON" ] && exit 1;; esac',
  'exit 0',
  '',
].join('\n')

const FRONTEND_CALLS = [
  'repo: npm run typecheck --silent',
  'repo: npm run lint --silent',
  'repo: npm run lint:complexity --silent',
  'repo: npm test --silent -- --coverage --coverageThreshold={}',
  'repo: node scripts/ci/runDiffCoverage.ts --coverage coverage/coverage-final.json --prefix src/ --prefix scripts/ --base base',
]

const SERVER_CALLS = [
  'server: npm run typecheck --silent',
  'server: npm run lint --silent',
  'server: npm run lint:complexity --silent',
  'server: npm test --silent -- --coverage --coverageThreshold={}',
  'repo: node scripts/ci/runDiffCoverage.ts --coverage server/coverage/coverage-final.json --prefix server/src/ --base base',
]

interface Setup {
  root: string
  repo: string
  bin: string
  log: string
}

describe('.githooks/pre-push', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
      { cwd, encoding: 'utf8', env: cleanGitEnv(process.env) },
    )

  /** A repo whose `base` branch is behind `feature` (checked out), which changes the given files. */
  function makeRepo(changed: string[]): Setup {
    const root = mkdtempSync(join(tmpdir(), 'pre-push-'))
    dirs.push(root)
    const repo = join(root, 'repo')
    const bin = join(root, 'bin')
    mkdirSync(repo)
    mkdirSync(bin)
    git(repo, 'init', '-q', '-b', 'base')
    writeFileSync(join(repo, 'README.md'), 'x')
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'base')
    git(repo, 'checkout', '-q', '-b', 'feature')
    for (const file of changed) {
      mkdirSync(join(repo, file, '..'), { recursive: true })
      writeFileSync(join(repo, file), 'y')
    }
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'feature')
    for (const name of ['npm', 'node']) {
      writeFileSync(join(bin, name), STUB)
      chmodSync(join(bin, name), 0o755)
    }
    return { root, repo, bin, log: join(root, 'calls.log') }
  }

  const headOf = (setup: Setup) => git(setup.repo, 'rev-parse', 'HEAD').trim()
  const pushLine = (sha: string) => `refs/heads/feature ${sha} refs/heads/feature ${ZERO40}\n`

  const hookEnv = (setup: Setup, extra: Record<string, string> = {}) => ({
    ...cleanGitEnv(process.env),
    PATH: `${setup.bin}:${process.env.PATH}`,
    CALL_LOG: setup.log,
    PRE_PUSH_BASE: 'base',
    ...extra,
  })

  const readCalls = (log: string): string[] => {
    try {
      return readFileSync(log, 'utf8').trim().split('\n')
    } catch {
      return [] // the hook made no npm/node calls
    }
  }

  function runHook(setup: Setup, stdin: string, env: Record<string, string> = {}) {
    const result = spawnSync('bash', [HOOK, 'origin', 'url'], {
      cwd: setup.repo,
      input: stdin,
      encoding: 'utf8',
      env: hookEnv(setup, env),
    })
    return { status: result.status, calls: readCalls(setup.log), output: `${result.stdout}${result.stderr}` }
  }

  it.each([
    ['a 40-zero deletion', `(delete) ${ZERO40} refs/heads/old ${'a'.repeat(40)}\n`],
    ['a 64-zero deletion', `(delete) ${ZERO64} refs/heads/old ${'a'.repeat(64)}\n`],
    ['empty stdin (up-to-date push)', ''],
  ])('does nothing for %s', (_name, stdin) => {
    const { status, calls, output } = runHook(makeRepo(['src/a.ts']), stdin)
    expect(status).toBe(0)
    expect(calls).toEqual([])
    expect(output).toContain('nothing to check')
  })

  it('runs typecheck, lint, complexity, tests-for-report and the diff gate for frontend changes', () => {
    const setup = makeRepo(['src/a.ts'])
    const { status, calls, output } = runHook(setup, pushLine(headOf(setup)))
    expect(status).toBe(0)
    expect(calls).toEqual(FRONTEND_CALLS)
    expect(output).toContain('no server/ changes')
  })

  it('also runs the server gates, from server/, when the branch touches server/', () => {
    const setup = makeRepo(['server/src/x.ts'])
    mkdirSync(join(setup.repo, 'server', 'node_modules'), { recursive: true })
    const { status, calls } = runHook(setup, pushLine(headOf(setup)))
    expect(status).toBe(0)
    expect(calls).toEqual([...FRONTEND_CALLS, ...SERVER_CALLS])
  })

  it('refuses to push server changes when server/node_modules is missing', () => {
    const setup = makeRepo(['server/src/x.ts'])
    const { status, output } = runHook(setup, pushLine(headOf(setup)))
    expect(status).toBe(1)
    expect(output).toContain('server/node_modules')
  })

  it('still gates a push that mixes a deletion with an update', () => {
    const setup = makeRepo(['src/a.ts'])
    const stdin = `(delete) ${ZERO40} refs/heads/old ${'a'.repeat(40)}\n${pushLine(headOf(setup))}`
    expect(runHook(setup, stdin).calls).toEqual(FRONTEND_CALLS)
  })

  it('does not drop a last line that lacks its trailing newline', () => {
    const setup = makeRepo(['src/a.ts'])
    expect(runHook(setup, pushLine(headOf(setup)).trimEnd()).calls).toEqual(FRONTEND_CALLS)
  })

  it('refuses to vouch for a pushed commit that is not the checked-out HEAD', () => {
    const { status, calls, output } = runHook(makeRepo(['src/a.ts']), pushLine('b'.repeat(40)))
    expect(status).toBe(1)
    expect(calls).toEqual([])
    expect(output).toContain('check out what you are pushing')
  })

  it('warns, but still runs, when the working tree has uncommitted changes', () => {
    const setup = makeRepo(['src/a.ts'])
    writeFileSync(join(setup.repo, 'README.md'), 'dirty')
    const { status, calls, output } = runHook(setup, pushLine(headOf(setup)))
    expect(status).toBe(0)
    expect(output).toContain('uncommitted changes')
    expect(calls).toEqual(FRONTEND_CALLS)
  })

  it('fails early with a clear message on a Node without type stripping', () => {
    const setup = makeRepo(['src/a.ts'])
    const { status, calls, output } = runHook(setup, pushLine(headOf(setup)), { STUB_NODE_VERSION: '22.15.0' })
    expect(status).toBe(1)
    expect(calls).toEqual([])
    expect(output).toContain('Node 22.15.0 is too old')
  })

  it('aborts the push as soon as a gate fails', () => {
    const setup = makeRepo(['src/a.ts'])
    const { status, calls } = runHook(setup, pushLine(headOf(setup)), { FAIL_ON: 'lint:complexity' })
    expect(status).not.toBe(0)
    expect(calls).toEqual(FRONTEND_CALLS.slice(0, 3))
  })

  it('fails with a hint when the base ref does not exist', () => {
    const setup = makeRepo(['src/a.ts'])
    const { status, output } = runHook(setup, pushLine(headOf(setup)), { PRE_PUSH_BASE: 'origin/nope' })
    expect(status).toBe(1)
    expect(output).toContain('git fetch origin')
  })

  it('does not read a git failure (no merge base) as "no server changes"', () => {
    const setup = makeRepo(['src/a.ts'])
    git(setup.repo, 'checkout', '-q', '--orphan', 'unrelated')
    git(setup.repo, 'commit', '-q', '--allow-empty', '-m', 'unrelated root')
    git(setup.repo, 'checkout', '-q', 'feature')
    const { status, output } = runHook(setup, pushLine(headOf(setup)), { PRE_PUSH_BASE: 'unrelated' })
    expect(status).not.toBe(0)
    expect(output).not.toContain('no server/ changes')
  })

  describe('through a real `git push` and core.hooksPath', () => {
    function pushFeature(setup: Setup, env: Record<string, string> = {}) {
      const hooks = join(setup.root, 'hooks')
      mkdirSync(hooks)
      copyFileSync(HOOK, join(hooks, 'pre-push'))
      chmodSync(join(hooks, 'pre-push'), 0o755)
      const remote = join(setup.root, 'remote.git')
      execFileSync('git', ['init', '-q', '--bare', remote], { env: cleanGitEnv(process.env) })
      git(setup.repo, 'remote', 'add', 'origin', remote)
      const result = spawnSync('git', ['-c', `core.hooksPath=${hooks}`, 'push', 'origin', 'feature'], {
        cwd: setup.repo,
        encoding: 'utf8',
        env: hookEnv(setup, env),
      })
      const pushed = execFileSync('git', ['branch', '--list', 'feature'], { cwd: remote, encoding: 'utf8', env: cleanGitEnv(process.env) })
      return { status: result.status, calls: readCalls(setup.log), arrived: pushed.includes('feature') }
    }

    it('runs the hook with git’s real stdin and lets a passing push through', () => {
      const result = pushFeature(makeRepo(['src/a.ts']))
      expect(result).toEqual({ status: 0, calls: FRONTEND_CALLS, arrived: true })
    })

    it('blocks the push when a gate fails', () => {
      const result = pushFeature(makeRepo(['src/a.ts']), { FAIL_ON: 'lint:complexity' })
      expect(result.status).not.toBe(0)
      expect(result.arrived).toBe(false)
    })
  })
})

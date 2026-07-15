---
name: validate-before-commit
description: Validate the codebase before committing — run TypeScript typecheck (tsc -b), ESLint, and the test suite, and enforce a Conventional Commits message (feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert). Use when about to commit, when asked to check/validate/verify the code is commit-ready, or when a commit is rejected for failing checks or a bad commit message.
---

Paths below are relative to the repo root (`logbook/`).

This project enforces validation with real git hooks, not a manual
checklist — `git commit` itself runs the checks and rejects the commit
if any fail. The hooks are the harness; this skill documents them.

## How it's wired

- `.githooks/pre-commit` — runs typecheck, lint, and tests (if a
  `test` script exists in `package.json`).
- `.githooks/commit-msg` — rejects any commit whose subject line isn't
  Conventional Commits (`type(scope)?: description`).
- `package.json`'s `"prepare"` script runs
  `git config core.hooksPath .githooks` so hooks activate automatically
  on `npm install`. Verify it's active with:

  ```
  git config --get core.hooksPath
  # .githooks
  ```

  If that prints nothing, run `npm run prepare` once.

## Run (agent path)

Run the exact checks a commit will run, without committing:

```
git hook run pre-commit
```

Validate a candidate commit message the same way git will:

```
echo "feat: add offline sync queue" > /tmp/msg.txt
git hook run commit-msg -- /tmp/msg.txt
```

`git hook run` (git ≥2.36) resolves hooks through `core.hooksPath`, so
it exercises the real scripts — this is not a re-implementation.

Exit code `0` means the check passed; nonzero means it failed, with
the failing step's output printed above the exit line.

## Direct invocation

The hooks are plain scripts and can be run standalone (this is what
`git hook run` calls under the hood):

```
./.githooks/pre-commit
./.githooks/commit-msg <path-to-a-file-containing-the-message>
```

## Run (human path)

Nothing to do — `git commit` triggers both hooks automatically once
`core.hooksPath` is set. A failing typecheck/lint/test aborts the
commit before it's created; a non-conventional subject line aborts it
at the message stage. Bypass only if you know what you're doing:
`git commit --no-verify`.

## Gotchas

- `core.hooksPath` is a **local** git config, not committed — it's set
  via the `prepare` npm script, so it only takes effect after
  `npm install` has run once in a given clone.
- The pre-commit hook checks for a `test` script in `package.json`
  before running tests, and skips with a message if none exists yet —
  this repo didn't have a test runner configured at the time this
  skill was written (see project CLAUDE.md), so don't be surprised if
  an older clone shows "no test script configured yet".
- `tsc -b` is used directly (not `npm run build`, which also runs
  `vite build`) — it's the typecheck step alone, and it's incremental
  (respects `.tsbuildinfo`), so a second run with no changes is
  effectively instant.
- The commit-msg regex only checks the **first line** of the message;
  multi-line bodies are untouched.

## Troubleshooting

- **`git hook run: unknown option` or command not found** — your git
  is older than 2.36. Run the hook script directly instead:
  `./.githooks/commit-msg <file>`.
- **Hook doesn't seem to run on `git commit`** — check
  `git config --get core.hooksPath` returns `.githooks`; if empty, run
  `npm run prepare`.
- **`tsc -b` fails referencing a test file** (e.g. `Cannot find name
  'test'`/`'expect'`) — the test runner's types aren't wired into
  `tsconfig` yet; this is a project setup gap, not a hook bug.

# Infrastructure

This document covers everything that runs *around* the app code: local dev environment, git
hooks, CI, the AI-driven QA gate, and how the production build is produced. For the app's own
architecture, see [`docs/ARCHITECTURE.md`](ARCHITECTURE.md).

## Local dev environment

- **Node 20+** (developed on Node 22, CI runs Node 24), **npm 10+**.
- No backend, no database service, no environment variables/secrets are needed to run the app
  locally — it's a static Vite app that persists to the browser's own IndexedDB.
- `npm install` runs the `prepare` script (`git config core.hooksPath .githooks`), which points
  git at this repo's hooks instead of the default `.git/hooks`. This is what makes the pre-commit
  gate active on a fresh clone without any manual step.
- The on-device AI features additionally need Chrome flags and a model download — see
  `README.md` → "Browser & AI requirements". This is a *runtime* browser requirement, not a build
  or CI dependency: CI never touches the AI APIs (they're unavailable in a headless/CI Chromium
  anyway), which is exactly the scenario the "AI unavailability must never block" rule exists for.

## Git hooks (`.githooks/`)

Hooks are plain shell scripts, versioned in the repo (not `.git/hooks`, which isn't checked in),
wired up via `core.hooksPath`:

- **`pre-commit`** — runs, in order: `tsc -b` (typecheck) → `eslint` (lint) → `npm test` (full
  Jest suite). Any failure aborts the commit. This is intentionally the *same* sequence CI runs,
  so a passing local commit is a strong signal the CI static gate will also pass.
- **`commit-msg`** — rejects a commit whose subject line doesn't match Conventional Commits
  (`feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert(scope)?: description`).

Neither hook can be bypassed by CI — see below, the same checks run again server-side — so
`--no-verify` locally only defers the failure to the PR, it doesn't avoid it.

## CI pipeline (`.github/workflows/`)

Three workflows, all PR-triggered, none of which deploy anywhere (there is currently no hosted
deployment target — see [Build output](#build-output-and-hosting) below).

### 1. `ci-static.yml` — static gates

Triggers on every PR open/sync/reopen. Runs `npm ci`, then re-runs the **exact same
`.githooks/pre-commit` script** (typecheck → lint → test) plus a production `npm run build`. This
is the required, always-on check — it needs no comment or manual trigger.

### 2. `qa-gate-pending.yml` + `qa-gate-run.yml` — AI-driven QA release gate

This is a two-part, comment-triggered check:

```
PR opened/synced
      │
      ▼
qa-gate-pending.yml ──creates/resets a `qa-release-gate` check-run──► status: queued
                                                                       "comment /qa to run"
      │
      │  (a maintainer comments "/qa" on the PR)
      ▼
qa-gate-run.yml
      │
      ├─ marks the check-run in_progress
      ├─ npm ci, playwright install
      ├─ runs the Claude Code Action, instructed to follow
      │  .claude/agents/qa-release-gate.md: static gates, then start the
      │  dev server and drive every screen/flow with Playwright MCP tools
      ├─ parses the agent's structured `{ verdict, summary }` JSON output
      │  (GO / NO-GO / GO WITH CAVEATS)
      └─ completes the check-run (failure only on NO-GO — GO WITH CAVEATS
         passes, since caveats are meant to be visible but non-blocking)
         and posts the verdict as a PR comment
```

Both check-run-writing steps **update an existing check-run for the PR's head SHA instead of
creating a new one** (`checks.listForRef` → update if found, create only if not). This is
deliberate: `checks.create()` always makes a new check-run object even when one already exists for
that SHA, so a naive re-run would "orphan" the earlier one stuck in whatever status it was left in
(never resolving to success/failure) and leave two competing check-runs on the PR. The comment in
`qa-gate-pending.yml` explains this explicitly — don't switch either workflow to a blind
`checks.create()`.

`/qa` only runs for commenters whose `author_association` is `OWNER`, `MEMBER`, or `COLLABORATOR`
— an external contributor commenting `/qa` on a fork PR cannot trigger it.

**Required secret:** `CLAUDE_CODE_OAUTH_TOKEN`, consumed by `anthropics/claude-code-action@v1` to
run the QA agent. Without it, `/qa` will fail at that step (the seed check-run and static gates
still work independently of it).

The QA agent itself is defined in `.claude/agents/qa-release-gate.md` and is also invokable
locally as a subagent (see the `qa-release-gate` entry in this repo's available agents) — the CI
workflow and a local "QA this before I ship" request run the *same* procedure, just with different
triggers.

### Branch protection expectation

Per `README.md` → "Contributing / git workflow": both `ci-static` and `qa-release-gate` are
expected to be green before merge. `ci-static` runs unconditionally; `qa-release-gate` starts
`queued` and only resolves once someone comments `/qa` — so a PR can sit with one green, one
pending check until a maintainer explicitly requests the QA run.

## Build output and hosting

`npm run build` = `tsc -b` (typecheck, no emit) then `vite build`, which:

- Bundles the app into `dist/`.
- Runs `vite-plugin-pwa` in `generateSW` mode to emit the Workbox service worker and the PWA
  manifest (icons, `theme_color`/`background_color` mirroring the CSS tokens in `src/index.css`,
  `registerType: 'autoUpdate'`). See `docs/ARCHITECTURE.md` for why `autoUpdate` was chosen over
  a refresh-prompt flow.
- Precaches the full app shell (`globPatterns: ['**/*.{js,css,html,svg,png,woff2}']`) so a cold
  start with zero network serves the whole UI.

`npm run preview` serves `dist/` locally to sanity-check the real production bundle (including
service worker registration), which `npm run dev` alone doesn't fully exercise even though its
service worker is also enabled (`devOptions.enabled: true`) for iterating on offline behaviour.

**There is currently no CD step and no hosting target configured** — `dist/` is a static bundle
that could be deployed to any static host (GitHub Pages, Netlify, Vercel, S3+CDN, etc.), but no
workflow does so yet. Today the app is run locally (`npm run dev` / `npm run preview`) or
installed as a PWA from a locally-served origin. If a hosting target is added later, document the
decision here rather than only in the workflow YAML.

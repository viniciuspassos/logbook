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
- `server/` (entry persistence + file uploads, NestJS + Postgres) is a separate, standalone
  package — its own `package.json`, `tsconfig.json`, ESLint config, and Jest config, deliberately
  **not** wired into the root `package.json` or this project's TypeScript project references.
  Running the frontend (`npm run dev` / `build` / `test` / `preview`, all at the repo root) never
  requires `server/`'s dependencies to be installed, Docker to be installed, or any backend
  container to be running. This is the same "must never block" philosophy `CLAUDE.md` already
  applies to on-device AI availability, extended to the backend: **the backend is strictly
  additive infrastructure, not a dependency of the frontend.**

## Optional local backend infra (Docker Compose)

`docker-compose.yml` at the repo root brings up `server/`'s runtime dependencies for local
development — Postgres and the backend service itself — behind `docker compose`. This is
opt-in tooling for anyone working on `server/`; it changes nothing about how the frontend is run
or tested, and a contributor who never touches `server/` never needs Docker installed at all.

```
docker compose up --build     # start db + backend (db must report healthy before backend starts)
docker compose down           # stop; named volumes (db data, uploads) persist
docker compose down -v        # stop and also wipe db/upload volumes
```

Services:

- **`db`** — official `postgres:16.4-bookworm` image, credentials `logbook`/`logbook`/`logbook`
  (local-dev only, not secrets — never reused for anything real), data in the named volume
  `logbook-db-data`. Has a `pg_isready` healthcheck; `backend` uses
  `depends_on: db: condition: service_healthy` so it never races a not-yet-ready Postgres.
- **`backend`** — built from `server/Dockerfile` (multi-stage: a `build` stage compiles
  TypeScript with full devDependencies, a slim `runtime` stage ships only `dist/` + production
  `node_modules`, running as a non-root user). `DATABASE_URL` points at the `db` service by
  Compose network name. `UPLOAD_DIR` (`/app/uploads` inside the container) is backed by the named
  volume `logbook-uploads`, so uploaded files survive `docker compose down`/`up` and container
  recreation — `server/.env.example` flags the bare local-disk default as non-durable without
  this. Has an HTTP healthcheck against `GET /health`.
- No schema migration mechanism exists yet (see `server/src/database/typeorm.config.ts`):
  `synchronize` auto-syncs the schema from TypeORM entities outside `NODE_ENV=production`. This
  compose setup runs `NODE_ENV=development`, so a fresh `db` volume gets its schema created
  automatically on first `backend` boot — there's nothing to run by hand.

Verified locally: `db` reaches `healthy` before `backend` starts, `backend` reaches `healthy` via
its own `GET /health` check, `GET http://localhost:3000/health` responds `200` from the host, the
backend process inside the container runs as a non-root user, and files written under
`/app/uploads` survive a `docker compose restart backend`.

This is local-only tooling — there is no hosted deployment target for `server/`, matching the rest
of this document (see [Build output](#build-output-and-hosting) below for the frontend's own
no-hosting-target status).

## Backend authentication (`server/src/auth/`)

Now that the server is canonical (see `docs/ARCHITECTURE.md` → "Source of truth"), every
entries/attachments route requires a session. Single-user, httpOnly session cookie — full design
rationale lives in the auth PR description; this section is the operational summary.

- **`AUTH_PASSWORD_HASH`** (required, no default outside Docker Compose) — a scrypt hash of the
  single-user login password, generated with `npm run hash-password -- "<password>"` inside
  `server/` and pasted into `server/.env`. The plaintext password is never stored anywhere,
  including env vars — only its hash. `docker-compose.yml` bakes in a default hash (of
  `logbook-dev-password`) purely for `docker compose up` to work out of the box, the same way it
  bakes in the default Postgres `logbook`/`logbook` credentials — replace it for anything beyond
  throwaway local use. Note the hash format is `$`-delimited (`scrypt$<cost>$<saltHex>$<hashHex>`),
  which needs every `$` doubled to `$$` when set as a literal in `docker-compose.yml`'s
  `environment:` block — Compose otherwise treats a single `$` as the start of a variable
  reference and silently mangles the value.
- **`SESSION_TTL_DAYS`** (optional, default `30`) — how long a session cookie lives before
  expiring. It slides forward on use (renewed once less than half the TTL remains) rather than on
  a fixed schedule, so a session doesn't get a full database write on every single request. The
  default is deliberately long: the product requirement is that a multi-day trip with no
  connectivity, followed by the client's offline write queue flushing on reconnect, must not fail
  because the session expired while the device was offline and unable to renew it.
- **Session storage is Postgres-backed** (a `sessions` table), not in-memory. The tradeoff was
  considered explicitly: in-memory is simpler and needs no schema, but loses every session on a
  container restart/redeploy — for a session designed to survive a multi-day offline trip, losing
  it on every deploy would undermine the reason it's long-lived in the first place. Postgres is
  already a hard dependency of this app (entries/attachments), so persisting sessions there adds
  no new infrastructure.
- **CSRF**: SameSite=Lax cookies alone were not treated as sufficient, because this API's eventual
  frontend deployment topology (same-origin vs. a separate origin) isn't settled — frontend
  integration is a separate, still-blocked piece of work. A double-submit CSRF token (a
  non-httpOnly `logbook_csrf` cookie, echoed back in an `X-CSRF-Token` header on every mutating
  request and checked against the session's stored copy) is layered on top and doesn't depend on
  that decision. See `server/src/auth/csrf.guard.ts` for the implementation.
- **`/health` and `POST /auth/login`** are the only public routes (`@Public()`), via a global guard
  registered in `AuthModule` — every other route is protected by default rather than opted in
  per-controller, so a new controller added later doesn't ship unauthenticated by omission.

## Git hooks (`.githooks/`)

Hooks are plain shell scripts, versioned in the repo (not `.git/hooks`, which isn't checked in),
wired up via `core.hooksPath`:

- **`pre-commit`** — runs, in order: `tsc -b` (typecheck) → `eslint` (lint) → `npm test` (full
  Jest suite), all for the frontend. Any failure aborts the commit. This is intentionally the
  *same* sequence CI runs, so a passing local commit is a strong signal the CI static gate will
  also pass. It then checks whether any staged file is under `server/`; if so, it additionally
  runs `server/`'s own typecheck → lint → test sequence (see below for why this is scoped rather
  than unconditional).
- **`commit-msg`** — rejects a commit whose subject line doesn't match Conventional Commits
  (`feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert(scope)?: description`).

### Why the backend gate is scoped to staged `server/` changes, not always-on

The frontend gates above run unconditionally on every commit, regardless of which files changed —
that's a deliberate, simple all-or-nothing design. The backend gate does **not** follow that
pattern, for a concrete reason rather than an inconsistency: `server/` is a standalone package
with its own `node_modules`, installed by running `npm install` *inside* `server/`, separately
from the root `npm install`. If the hook ran `server/`'s typecheck/lint/test unconditionally, a
contributor who has only ever run the root `npm install` — e.g. someone fixing a typo in
`README.md` — would have every commit fail with "cannot find module" errors from a toolchain they
never set up and whose commit doesn't even touch. That's a hard block, not a slow inconvenience,
and it would violate the same "backend must never get in the frontend's way" rule this document
states above. Scoping the backend gate to `git diff --cached --name-only` containing a `server/`
path keeps the "same checks as CI" guarantee for anyone actually changing `server/`, without
imposing the backend toolchain on everyone else's commit path. If `server/node_modules` is missing
when a `server/` change *is* staged, the hook fails fast with an explicit "run `npm install` in
`server/` first" message rather than a confusing module-resolution error.

Neither hook can be bypassed by CI — see below, the same checks run again server-side — so
`--no-verify` locally only defers the failure to the PR, it doesn't avoid it.

## CI pipeline (`.github/workflows/`)

Three workflows, all PR-triggered, none of which deploy anywhere (there is currently no hosted
deployment target — see [Build output](#build-output-and-hosting) below).

### 1. `ci-static.yml` — static gates

Triggers on every PR open/sync/reopen and now runs two independent jobs:

- **`static-gates`** — frontend. Runs `npm ci`, then re-runs the **exact same
  `.githooks/pre-commit` script** (typecheck → lint → test) plus a production `npm run build`.
- **`server-static-gates`** — backend. Runs unconditionally on every PR (not path-filtered),
  unlike the pre-commit hook's staged-file scoping — a CI job doesn't have the "contributor
  hasn't installed this toolchain yet" problem the hook is scoped to avoid, and an always-on
  required check is simpler to reason about than a path-conditional one. From `server/`: `npm ci`
  → `npm run typecheck` → `npm run lint` → `npm test` → `npm run build`. `server/`'s Jest suite
  runs against an in-memory `sql.js` SQLite build rather than a live Postgres, so this job needs
  no database service container to pass.

Both jobs run unconditionally on every PR — neither needs a comment or manual trigger. Whether
`server-static-gates` is additionally configured as a *required* status check in this repository's
branch-protection settings (alongside `static-gates`) is a GitHub repo setting, not something
tracked in this file or in workflow YAML.

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
expected to be green before merge. `ci-static` runs unconditionally (as both its `static-gates` and
`server-static-gates` jobs); `qa-release-gate` starts `queued` and only resolves once someone
comments `/qa` — so a PR can sit with one green, one pending check until a maintainer explicitly
requests the QA run. Whether `server-static-gates` is marked as a required check alongside
`static-gates` in this repository's branch-protection rules is a manual GitHub setting outside this
repo's version-controlled config.

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

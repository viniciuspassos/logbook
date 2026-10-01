# Infrastructure

This document covers everything that runs *around* the app code: local dev environment, git
hooks, CI, and how the production build is produced. For the app's own architecture, see
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md).

## Local dev environment

- **Node 22.18+** (CI runs Node 24; the `scripts/ci` TypeScript runs natively via Node's type
  stripping, and the `pre-push` hook checks for it), **npm 10+**.
- No backend, no database service, no environment variables/secrets are needed to run the
  frontend or persist entry text locally — it's a static Vite app that persists entries to the
  browser's own IndexedDB. Photo attachments are the exception: they have no local durable store
  of their own (only a transient offline-outbox queue), so actually saving a photo requires the
  backend below to be running and reachable — see `README.md` → "Running the backend".
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
  additive infrastructure for running, building, and testing the frontend.** It is not additive
  for photo attachments, though — the backend is the only durable store they have (see the note
  above); running without it means added photos never get past the local offline queue.

## Optional local backend infra (Docker Compose)

`docker-compose.yml` at the repo root brings up `server/`'s runtime dependencies for local
development — Postgres and the backend service itself — behind `docker compose`. This is
opt-in tooling for anyone working on `server/`, or who wants photo attachments to actually
persist; it changes nothing about how the frontend itself is run or tested (entries still work
with zero setup), and a contributor who never touches `server/` and doesn't care about photo
durability never needs Docker installed at all.

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
- Schema is created and evolved entirely by TypeORM migrations (see "Database migrations
  (`server/src/database/`)" below) — `synchronize` is `false` in every environment, including this
  Compose setup's `NODE_ENV=development`. `migrationsRun: true` (`server/src/database/typeorm.config.ts`)
  means pending migrations apply automatically the moment `backend` connects, so a fresh `db`
  volume still gets its schema created with no manual step. Verified locally: `docker compose up
  --build` against a brand-new `db` volume creates `entries`/`attachments`/`sessions` via the
  baseline migration (tracked in TypeORM's own `migrations` table) before `backend` reports
  healthy.

Verified locally: `db` reaches `healthy` before `backend` starts, `backend` reaches `healthy` via
its own `GET /health` check, `GET http://localhost:3000/health` responds `200` from the host, the
backend process inside the container runs as a non-root user, and files written under
`/app/uploads` survive a `docker compose restart backend`.

This is local-only tooling — there is no hosted deployment target for `server/`, matching the rest
of this document (see [Build output](#build-output-and-hosting) below for the frontend's own
no-hosting-target status).

## Database migrations (`server/src/database/`)

Schema is managed entirely by TypeORM migrations (#21) — `synchronize` is `false` in every
environment. There is no auto-sync path left, in dev or production: a developer who changes an
entity has to generate and commit a migration, the same way they'd write a test for new behavior.

- **Why no dev/prod split, and why tests are the one exception.** Auto-sync used to be on outside
  `NODE_ENV=production` for fast local iteration, with production the only environment expected to
  run migrations — except production had *no* migration mechanism at all, so a real deploy would
  have started completely unmigrated. Migrations now exist, so there's no reason left to keep two
  schema-deploy paths for dev and prod; both go through the same reviewable, reversible migration
  history. The three e2e suites (`entries.e2e.test.ts`, `auth.e2e.test.ts`,
  `attachments.e2e.test.ts`) are the deliberate exception: they build their own in-memory `sql.js`
  (pure-JS SQLite) schema via a literal `TypeOrmModule.forRoot({ synchronize: true, ... })`,
  entirely separate from `typeorm.config.ts`. Forcing them onto migrations instead would mean
  either writing every migration portable across SQLite and Postgres, or moving the suites onto a
  real Postgres container and making `npm test` substantially slower — for coverage of *behavior*,
  not the schema deploy path, which is what the drift check below covers instead.
- **Changed an entity? Generate a migration.** With a Postgres reachable at `DATABASE_URL` (e.g.
  `docker compose up db` from the repo root, or any local Postgres) and the target schema already
  migrated to the previous state:
  ```
  cd server
  npm run migration:generate -- src/database/migrations/DescriptiveName
  ```
  Review the generated SQL (TypeORM diffs the live database against entity metadata — it's usually
  right, but not infallible, especially for renames, which it sees as a drop + add), then commit
  the migration file alongside the entity change in the same PR. `npm run migration:create --
  src/database/migrations/Name` writes an empty migration for changes TypeORM can't infer (e.g.
  data backfills) — fill in `up`/`down` by hand.
- **Running migrations.** `npm run migration:run` applies every pending migration;
  `npm run migration:revert` rolls back the most recently applied one. Neither is a required manual
  step for local dev or `docker compose up` — see `migrationsRun: true` below — but both are
  available for e.g. reverting a bad migration, or running migrations against a database the app
  itself isn't currently connected to.
- **The running app applies migrations automatically on boot** (`migrationsRun: true` in
  `server/src/database/typeorm.config.ts`), in every environment, including this Compose setup and
  a from-scratch `docker compose up` against a brand-new `db` volume. This was chosen over a
  separate, explicit "run migrations" deploy step because there is currently no CD pipeline or
  hosted deployment target for `server/` (see below) — Compose's `backend` container *is* the only
  "deployment" that exists today, and it's still single-instance, so there's no risk of two
  instances racing to apply the same migration concurrently. Revisit this (move to an explicit
  pre-boot migration step, e.g. a Compose `command` override or a CD pipeline stage) if/when a real
  multi-instance deployment target is added — auto-run-on-boot stops being safe once more than one
  instance can start at once.
- **The TypeORM CLI (`server/src/database/data-source.ts`)** is a separate `DataSource`, used only
  by `npm run migration:*` (via `typeorm-ts-node-commonjs`, see `server/package.json`), not by the
  running app. It runs outside Nest's DI entirely, so it loads `server/.env` itself (via `dotenv`)
  and only needs `DATABASE_URL` — not the full `AppConfig` the app needs (which also requires
  `AUTH_PASSWORD_HASH`, unrelated to migrations). It explicitly lists every entity
  (`server/src/database/entities.ts`) because it has no Nest module graph to discover them from;
  the running app instead uses `autoLoadEntities: true` via each module's own
  `TypeOrmModule.forFeature()` registration.
- **CI drift check (`server-migrations-drift` in `.github/workflows/ci-static.yml`)** is what
  replaces the coverage lost by keeping the sqlite-backed e2e suites off migrations. It spins up a
  real Postgres service container, runs every committed migration against it, then re-runs
  `migration:generate` and fails if that produces a *new* migration file — i.e. if entities and
  committed migrations have diverged. Note the inverted signal: TypeORM's `migration:generate` CLI
  exits `1` when there's *nothing* to generate ("no changes... cannot generate a migration") and
  exits `0` (while writing a file) when there *is* a diff — so the job checks whether a migration
  file was written, not the exit code, which would otherwise mean the opposite of what it looks
  like. Verified locally by temporarily adding a column to an entity with no matching migration,
  confirming `migration:generate` wrote a new file for it (drift correctly detected), then
  reverting.
- **First migration is a single baseline** (`Baseline<timestamp>.ts`), generated from the current
  entities (`Entry`, `Attachment`, `Session`). Nothing has been deployed, so there's no live data to
  preserve and no real intermediate schema history to reconstruct — splitting it to mirror how the
  schema evolved during development would be fiction.
- **No DB-level `ON DELETE CASCADE` on `attachments.entryId`.** Deleting an `Entry` cascade-deletes
  its `Attachment` rows today entirely at the application layer
  (`EntriesRepository.removeCascade`, #20), not via a foreign-key constraint — `entryId` is a plain
  column, not a TypeORM relation, by deliberate design (see the comment on `Attachment` in
  `server/src/attachments/attachment.entity.ts` for the full reasoning). Migrations existing now
  doesn't change that: modeling a real FK would require converting `entryId` into a proper
  `@ManyToOne`/`@JoinColumn` relation, which is a behavior change for every repository/service
  method that reads or filters on `entryId` today, and `removeCascade` is verifiably the only code
  path that deletes an `Entry` row. A DB-level constraint would be defense-in-depth against a future
  bug bypassing the repository layer, not a replacement for the app-layer cascade — worth adding if
  `Attachment` ever needs a real relation for other reasons, not on its own today.

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

- **`pre-commit`** — runs, in order: `tsc -b` (typecheck) → `eslint` (lint) → `npm run lint:complexity` (strict complexity limits) → `npm test --
  --coverage` (full Jest suite, with coverage collected and enforced), all for the frontend. Any
  failure aborts the commit. This is intentionally the *same* sequence CI runs, so a passing local
  commit is a strong signal the matching per-rule CI jobs will also pass. It then checks whether any staged
  file is under `server/`; if so, it additionally runs `server/`'s own typecheck → lint → complexity → test
  (with `--coverage`) sequence (see below for why this is scoped rather than unconditional).
- **`pre-push`** — branch-wide checks that need `origin/main`: `tsc -b` → `eslint` →
  `npm run lint:complexity` → a Jest run for the coverage report (threshold off; `pre-commit` and
  CI enforce it) → the diff-aware coverage gate (every function the branch modified must be
  executed by a test; see "Diff-aware coverage gate"). If the branch touches `server/`
  (`git diff origin/main...HEAD`) the same sequence runs there, and the push is refused when
  `server/node_modules` is missing. Pure branch deletions and empty pushes are skipped; a missing `origin/main`
  fails with a "git fetch origin" hint. The gates check the checked-out `HEAD` and working tree,
  so the hook refuses a push of any commit that is not `HEAD` and warns about uncommitted changes
  (it does not fetch `origin/main` itself — a stale tracking ref widens the diff). It also needs
  Node 22.18+. Never bypass it with `--no-verify` — CI runs the same gates per rule. It is tested
  by running the real script (`scripts/ci/prePush.test.ts`) against stub `npm`/`node` binaries,
  including through a real `git push` and `core.hooksPath`; `PRE_PUSH_BASE` exists only for that.
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

None of these hooks can be bypassed by CI — see below, the same checks run again server-side — so
`--no-verify` locally only defers the failure to the PR, it doesn't avoid it.

## CI pipeline (`.github/workflows/`)

Three workflows, all PR-triggered, none of which deploys anywhere (there is currently no hosted
deployment target — see [Build output](#build-output-and-hosting) below).

### `ci-static.yml` — per-rule gates

Triggers on every PR open/sync/reopen. Each gate is its **own job**, so a red check names the
rule that failed instead of hiding inside one generic "static-gates" result. The frontend jobs
mirror `.githooks/pre-commit`; the backend jobs run from `server/`:

| Frontend job | Backend job | Runs |
| --- | --- | --- |
| `frontend-typecheck` | `server-typecheck` | `npm run typecheck` (`tsc -b` / `tsc --noEmit`) |
| `frontend-lint` | `server-lint` | `npm run lint` (ESLint, no complexity rules) |
| `frontend-complexity` | `server-complexity` | `npm run lint:complexity` (see below) |
| `frontend-test-coverage` | `server-test-coverage` | `npm test -- --coverage` (100% function gate) |
| `frontend-diff-coverage` | `server-diff-coverage` | every function the PR modified must be executed by a test (see below) |
| `frontend-build` | `server-build` | `npm run build` |

- The backend jobs run unconditionally (not path-filtered), unlike the pre-commit hook's
  staged-file scoping — a CI job doesn't have the "contributor hasn't installed this toolchain
  yet" problem the hook is scoped to avoid, and an always-on required check is simpler to reason
  about than a path-conditional one. `server/`'s Jest suite runs against an in-memory `sql.js`
  SQLite build rather than a live Postgres, so those jobs need no database service container.
- **`server-migrations-drift`** — backend, and the one job here that *does* need a real database:
  a `postgres:16.4-bookworm` service container. Runs the committed migrations against it, then
  fails if `migration:generate` would produce a new one — see "Database migrations" above for the
  full mechanics and why the exit code alone isn't the signal to check.

All jobs run unconditionally on every PR — none needs a comment or manual trigger. Which of them
are *required* is a GitHub branch-protection setting, not tracked in workflow YAML — see
"Branch protection expectation" below.

### Diff-aware coverage gate

`frontend-diff-coverage` / `server-diff-coverage` answer "did this PR leave a function it touched
without a test?" with an annotation on the exact function, instead of a global percentage. The
script (`scripts/ci/diffCoverage.ts`, run via `runDiffCoverage.ts`) does three steps:

1. `git diff --merge-base origin/<base> -U0` → the changed lines per file (`changedLines.ts`).
   In CI this equals `base...HEAD`; locally it also includes uncommitted edits to tracked files,
   so brand-new files need `git add -N <path>` to be seen. Git's `GIT_*` environment is stripped
   first, because hooks export `GIT_DIR`/`GIT_INDEX_FILE` and would otherwise redirect the call. A
   diff header it cannot parse is an error, never a silently skipped file;
2. the TypeScript AST → every function whose span contains a changed line, including enclosing
   functions of a changed nested callback and decorator-line edits (`functionSpans.ts`);
3. Jest's `coverage-final.json` → each such function must have a hit count > 0
   (`coverageMatch.ts`, the pure half; `diffCoverage.ts` does the git and file I/O). A modified
   function with *no* entry in the report also fails (fail closed). Modified functions in a file
   absent from the report (types, seed data, `*.module.ts`, migrations: excluded from
   `collectCoverageFrom`) only produce a `::warning`, and the run ends with an "N modified
   function(s) in M file(s) checked" line. If no coverage path is under the repo root the gate
   errors instead of silently checking nothing.

Matching an AST function to istanbul's entry needs the same start line (istanbul's `decl`, the
name line) and an end line at most 2 short (istanbul's `loc` is the function *body*, so a
parenthesised JSX arrow ends one line before the AST's); functions starting on one line are told
apart by start column. This was validated against every function in both packages' real coverage
reports (572/572). The `*-diff-coverage` jobs run Jest with `--coverageThreshold='{}'` — the
global threshold is enforced by `*-test-coverage`; leaving it on here would fail Jest first and
skip the step that names the function. They need full history (`fetch-depth: 0`) and the root
`npm ci` (for the `typescript` package), even in the server job. Run it locally after a coverage
run: `node scripts/ci/runDiffCoverage.ts --coverage coverage/coverage-final.json --prefix src/
--prefix scripts/ --base origin/main` (server: `--coverage server/coverage/coverage-final.json
--prefix server/src/`).

It overlaps with the global 100%-function threshold in both Jest configs (an untested new function
already trips that). Its value is the per-function annotation, and that it keeps gating the
changed code if a global threshold is ever relaxed. "Executed by a test" is a hit count, not an
assertion-quality check.

### Complexity gate

Its own job (`frontend-complexity` / `server-complexity`) and its own ESLint config
(`eslint.complexity.config.js`, `server/eslint.complexity.config.js`), kept out of the normal lint
config so a failure is unambiguous: `complexity` ≤ 10, `max-depth` ≤ 3 (nested ifs/loops),
`max-params` ≤ 4, `max-nested-callbacks` ≤ 3 and `max-lines-per-function` ≤ 80 (blank lines and
comments excluded). The last two are off for `*.test.*` files, where `describe`/`it` nesting and
long suites are normal. The two configs repeat the numbers because `server/` is kept a standalone
package; update both together. `server/scripts/` is not linted (pre-existing gap).

Violations that predate the gate are recorded in `eslint-complexity-suppressions.json` (ESLint bulk
suppressions, wired in through `--suppressions-location` in `npm run lint:complexity`) rather than
loosening the limits. This blocks *new* violations and fails when a suppressed violation is fixed
but its entry remains (run `npm run lint:complexity -- --prune-suppressions`). It does **not** stop
an already-suppressed function from getting worse, nor someone adding entries by hand or with
`--suppress-all` — so never add or raise entries; refactor instead, and treat changes to that file
in review as red flags. Suppressions apply on the CLI only, so editors may still underline the
suppressed spots. Burn-down is tracked in #71. Keep the file even when empty (`{}`): the explicit
`--suppressions-location` errors if it is missing. Inline `eslint-disable complexity` comments are
not an escape hatch either — `npm run lint` flags them as unused directives, so `--fix` would
delete them and `lint:complexity` would then fail.

### `ci-pr-hygiene.yml` — PR metadata gate

One job, **`pr-hygiene`**, on PR open/**edit**/sync/reopen (so fixing the description turns it
green without a new push). It fails a PR unless it has:

- a Conventional Commits title (the squash-merge subject comes from the PR title and bypasses
  `.githooks/commit-msg`; a Jest test keeps the two patterns identical),
- a `## Summary` section with real content (untouched template placeholders and sub-headings
  don't count),
- a `Closes/Fixes/Resolves/Refs #N` link (outside HTML comments) to an *existing issue* — a PR
  number is rejected. There is deliberately no opt-out label: every PR needs an issue.

Rules are pure functions in `scripts/ci/prMetadata.ts`; the GitHub API lookups are in
`scripts/ci/checkPrMetadata.ts`. Node 24 runs the `.ts` files directly (type stripping), so
there is no build step. `scripts/` is part of the Jest suite *and* the 100%-function coverage
gate. Known limit: on `pull_request` events the checker runs from the PR's own merge commit, so a
PR could edit the checker to pass itself — review changes under `scripts/ci/` accordingly
(checking out the base branch instead would delay checker changes until after merge).

The AI-driven QA release gate (`qa-release-gate`) no longer runs in CI — it was dropped as
unhelpful. The underlying agent still exists at `.claude/agents/qa-release-gate.md` and is
invokable locally as a subagent (see the `qa-release-gate` entry in this repo's available agents)
for an on-demand "QA this before I ship" pass; it just no longer has a GitHub Actions workflow or
PR check-run attached to it.

### `ci-docker.yml` — server Docker build

One job, **`server-docker-build`**, runs `docker build` against `server/Dockerfile` to verify the
server image builds successfully. This catches regressions in the Dockerfile or missing
dependencies before deployment. The job does not push to any registry; it only verifies the build
succeeds locally on ubuntu-latest.

### `ci-secrets.yml` — secret scanning

One job, **`secret-scan`**, on PR open/sync/reopen. It scans every commit in the PR (via gitleaks)
for accidentally-committed secrets — API keys, tokens, credentials, etc. Fails if any match known
secret patterns. CLAUDE.md forbids committing secrets; this gate enforces it.

**If a false positive occurs** (e.g. a placeholder string in `.env.example` or a test fixture
that looks like a secret), add a minimal allowlist entry to `.gitleaks.toml` in the repo root with
a comment explaining why. Do not add allowlist entries speculatively; only for real false positives.

**Scanning scope**: gitleaks scans only the PR's commits (the range `origin/<base-branch>..HEAD`),
not the entire repository history.

**What to do if a secret leaks**: If a real secret is committed and the gate catches it, the
secret must be rotated / revoked immediately — committing the secret to a version-control system,
even temporarily, is a compromise. Removing it from the repo in a follow-up commit does not secure
it. Any service account, API key, or token that appears in the Git history must be invalidated and
replaced.

### `ci-deps.yml` — dependency audit

One job, **`dependency-audit`**, that runs on every PR (opened/synchronize/reopened) plus a weekly
schedule (Monday 6am UTC) so newly published security advisories surface without waiting for a PR.
The job audits production dependencies (`--omit=dev`) for high and critical known vulnerabilities
in both the root package and `server/`, failing the PR if any are found. The gate does not ignore
findings — if a high/critical vulnerability is discovered, it must be fixed (upstream version bump
or a code change mitigating it), documented, and discussed in review before merge. Dependabot is
intentionally **not** configured to auto-open PRs, since its PRs would fail the `pr-hygiene` gate
(every PR needs a linked issue) and would require manual issue creation anyway.

### `ci-bundle-size.yml` — bundle size budget

One job, **`frontend-bundle-size`**, on every PR (same trigger as static gates). Measures gzip
sizes of all `.js` and `.css` files under `dist/assets` and fails if:

- Total JS exceeds the budget (currently 89088 bytes / 87 KiB, `maxTotalJsBytes`)
- Total CSS exceeds the budget (currently 6144 bytes / 6 KiB, `maxTotalCssBytes`)
- Any single JS chunk exceeds the per-file max (currently 89088 bytes / 87 KiB, `maxSingleJsChunkBytes`)

An offline-first PWA should make bundle growth a conscious decision. The budgets are defined as
constants in `scripts/ci/bundleSize.ts` with comments explaining how and why to change them.
Measured sizes and justification belong in the PR description when raising a budget.

Rules are pure functions in `scripts/ci/bundleSize.ts`; file walking and gzip measurement in
`scripts/ci/checkBundleSize.ts`. `scripts/` is part of the Jest suite *and* the 100%-function
coverage gate.

### Branch protection expectation

Per `README.md` → "Contributing / git workflow": every check is expected to be green before
merge. These are the required status checks on `main` (strict mode, so a PR must be up to date):
`frontend-typecheck`, `frontend-lint`, `frontend-complexity`, `frontend-test-coverage`,
`frontend-diff-coverage`, `frontend-build`, `frontend-bundle-size`, `server-typecheck`,
`server-lint`, `server-complexity`, `server-test-coverage`, `server-diff-coverage`,
`server-build`, `server-migrations-drift`, `server-docker-build`, `secret-scan`,
`dependency-audit` and `pr-hygiene`. This is a repo setting outside the version-controlled config:
**renaming or adding a job means updating that list too**, or `main` will wait forever on a check
that no longer exists (or silently not gate on a new one).

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

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Logbook is an offline-first Progressive Web App (PWA) for mountaineers and skydivers to record their adventures, even in places with little or no internet connectivity (see `package.json` description). It is a working app: an installable, offline-capable PWA that captures entries by voice, structures and polishes them with Chrome's built-in on-device AI, persists them in IndexedDB, and exports them to Markdown/PDF/JSON.

Photo attachments and a background sync client are now implemented ([#26](https://github.com/viniciuspassos/logbook/issues/26)): entries and photos push to a NestJS + Postgres backend (`server/`) through an offline outbox, best-effort and silently degrading when the backend is unreachable — see `docs/ARCHITECTURE.md` → "Source of truth". Two things are still missing before that's a real cloud-sync feature: there's no pull/reconcile path back from the server (today's outbox only pushes local changes), and no login screen is wired up (`src/lib/sync/authApi.ts` exists but nothing calls it), so sync will 401 against a deployment with auth enabled. Everything else in `README.md`'s "Product vision" is live.

The AI and speech features require desktop Chrome with the built-in AI flags enabled (README → "Browser & AI requirements"). They are always optional at runtime — see Browser AI rules below.

For the *why* behind the architecture (state composition, layering, key decisions like
IndexedDB-over-localStorage or on-device-AI-over-cloud) see `docs/ARCHITECTURE.md`. For CI, git
hooks, and the build/PWA pipeline, see `docs/INFRASTRUCTURE.md`.

## Commands

- `npm run dev` — start the Vite dev server with HMR (the service worker is enabled in dev too)
- `npm run build` — type-check via `tsc -b` (project references: `tsconfig.app.json` + `tsconfig.node.json`), then production build via `vite build` (also emits the manifest + service worker)
- `npm run lint` — run ESLint over the whole repo
- `npm test` — run the Jest suite (jsdom + Testing Library)
- `npm run preview` — serve the production build locally (needed to exercise the real PWA/offline behaviour)

`.githooks/pre-commit` gates every commit on typecheck → lint → tests, and `.githooks/commit-msg` enforces Conventional Commits. `npm install` wires the hooks up via the `prepare` script.

`server/` is a separate NestJS + Postgres backend package with its own `package.json`/`npm install`/scripts — not wired into the root project references, and not required to run, build, or test the frontend. See `docs/INFRASTRUCTURE.md` for its commands, Docker Compose setup, and how CI gates it.

## Before implementing

Sync local `main` (`git fetch origin && git log origin/main`) and search the codebase/issue tracker for the requested behavior before writing code. Several past sessions duplicated work that had already merged (e.g. the soft-delete tombstone feature) — a grep is orders of magnitude cheaper than a redundant implementation, review, and PR.

**Isolate parallel sessions on their own branch.** The user often runs multiple unrelated Claude Code sessions against this repo at once, and a new session inherits whatever branch happens to be checked out — which may belong to a different, unrelated task another session is mid-way through. Before making any code or documentation change, check whether the current branch's purpose matches this task; if it doesn't (or you're on `main`), create a fresh branch off `origin/main` (`git fetch origin && git checkout -b <type>/<slug> origin/main`) before editing anything. Only keep working on the current branch when this task is a continuation of what that branch is already doing.

## Testing

Follow Test-Driven Development: write the failing Jest test for the behavior first, then write the minimum code to make it pass, then refactor. Every function, both backend and frontend, must have a unit test written with Jest. When adding a function, add or update its corresponding Jest test in the same change.

Tests must never be deleted to make a change land. If a test's behavior is genuinely no longer applicable (e.g. the function it covers was intentionally removed), the removal must be called out explicitly and justified in the change — never delete or silently weaken a test because it's inconvenient or failing.

## Architecture

- Build tooling: Vite (`vite.config.ts`) with `@vitejs/plugin-react` and `vite-plugin-pwa` (manifest + Workbox `generateSW`, `registerType: 'autoUpdate'`, service worker enabled in dev).
- TypeScript is split via project references from the root `tsconfig.json` into:
  - `tsconfig.app.json` — app code under `src/`, bundler module resolution, `noEmit`, strict unused-locals/params checks.
  - `tsconfig.node.json` — Node-side config (`vite.config.ts` itself).
- Linting: flat ESLint config (`eslint.config.js`) combining `@eslint/js` recommended, `typescript-eslint` recommended, `eslint-plugin-react-hooks`, and `eslint-plugin-react-refresh` (Vite variant). `dist` is ignored. Keep `any` out of new code — prefer `unknown` + narrowing, or the ambient interfaces in `src/types/`.
- Entry point: `index.html` → `src/main.tsx` mounts `<App />` from `src/App.tsx` into `#root` under `React.StrictMode`.
- App icons and the PWA icon set live in `public/` (`icon.svg` is the source of truth; the PNGs are rendered from it). Component-local assets live in `src/assets/`.
- Theme tokens (`--lb-*`) are defined once in `src/index.css`, with a `prefers-color-scheme: dark` block. Add new colours there rather than hardcoding hex in a component's CSS; the manifest/`theme-color` values in `vite.config.ts` and `index.html` mirror them.

### State composition

`useLogbookApp` is the composition root and owns nothing itself. It wires together:

- `useNavigation` — tab, overlay, timeline view, selected entry.
- `useEntries` — the persisted list; loads from IndexedDB on mount, seeds from `src/data/entries.ts` only when the store is empty, and write-throughs on save. `data/entries.ts` is seed data, **not** the live source of truth.
- `useNewEntryFlow` — the capture → listening → processing → review state machine, speech, and AI orchestration.
- `useExportActions` — Markdown/PDF/backup/restore, with a `busy` guard and a status message.
- `useSyncOutbox` — registers the reconnect trigger and does a mount-time drain against the backend outbox (`src/lib/sync/`); exposes `queueEntryCreate` for `saveEntry` to call.
- `useEntryAttachments` — the attachment gallery (server-confirmed + locally-queued photos) for whichever entry is open, and the upload flow.

Keep these concerns separate: put new state in the hook that owns that concern (or a new one) rather than growing `useLogbookApp` back into a god hook.

**Source of truth is moving to the server** ([#23](https://github.com/viniciuspassos/logbook/issues/23)): the target is that the backend owns the truth and IndexedDB becomes a local read cache and write queue. **Partially built**: [#26](https://github.com/viniciuspassos/logbook/issues/26) landed a background outbox (`src/lib/sync/`, `useSyncOutbox`) that pushes entry creates/updates/deletes and attachment uploads to the backend when it's reachable. `entriesStore` is still authoritative in shipped code, though — there's no pull/reconcile path back from the server yet, and a version conflict ([#24](https://github.com/viniciuspassos/logbook/issues/24)) is left queued with its error recorded rather than auto-resolved. The offline-capture rule is unaffected either way: creating and reading entries must keep working with no network, so a failed write queues rather than blocking the user — the same degradation philosophy as the Browser AI rules below.

### Layering

Screens and hooks must not touch flag-gated browser globals directly. All browser-API access goes through thin, individually-tested wrappers:

- `src/lib/ai/` — `availability`, `extractEntry`, `rewriteStory`, `searchEntries` (Prompt + Rewriter APIs)
- `src/lib/db/` — IndexedDB: `entriesStore.ts` (entries), `outboxStore.ts` (pending sync ops), `syncStateStore.ts` (local-id ↔ server-id/version mapping)
- `src/lib/backup/` — File System Access (JSON snapshot export/import)
- `src/lib/export/` — pure Markdown/printable-HTML formatters; shared field rules live in `entryFields.ts` so formats can't drift apart
- `src/lib/sync/` — the HTTP client for the `server/` backend (`httpClient`, `entriesApi`, `attachmentsApi`, `authApi`, `health`) plus the offline outbox (`outboxQueue`, `outboxRunner`)
- `src/types/*.d.ts` — ambient declarations for APIs missing from the DOM lib (speech, Chrome AI, File System Access)

This is what keeps a shifting origin-trial API surface a one-file change.

## Browser AI rules

**AI unavailability must never block entry creation.** See README → "Browser AI best practices" for the full pattern; the short version, which applies to any new on-device-AI work:

- Check `getAiCapabilities()` before creating a session; guard every global with `typeof X === 'undefined'` so jsdom and non-Chrome browsers are safe by default.
- Treat `'downloadable'`/`'downloading'` as usable — `create()` triggers the download.
- Degrade to the manual path on any failure (including `QuotaExceededError`); never surface an unhandled rejection.
- Pair every `create()` with `destroy()` in a `finally`, and thread an `AbortSignal` so closing the overlay cancels in-flight work.
- Run on-device models sequentially — Gemini Nano is a single local model.
- Never trust structured output; recover/validate before use.
- Announce async state through `aria-live` regions.

Tests must not install global AI/speech doubles in `jest.setup.ts` — the default state is real jsdom `undefined` ("unavailable"), and each test opts in locally.

<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%). Format flags (-c, -l, -L, -o, -Z) run raw.
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->
# Logbook

An **offline-first Progressive Web App (PWA)** for mountaineers and skydivers to record
their adventures — even in places with little or no internet connectivity. Logbook leans on
**on-device browser AI** (Chrome's built-in Prompt & Rewriter APIs) instead of cloud LLMs, so
capturing, structuring, and polishing an adventure log works without a network round-trip.

> **Project status — working, with gaps.**
> Voice capture, on-device AI extraction/rewrite, natural-language search, IndexedDB
> persistence, computed statistics, the installable PWA/offline shell, photo attachments, and the
> Markdown/PDF/JSON-backup exports are all implemented and covered by tests.
> `src/data/entries.ts` is now only a **one-time seed** for an empty store, not the live source
> of truth. A background outbox also pushes entries and photos to a NestJS + Postgres backend
> (`server/`) whenever it's reachable, degrading silently otherwise.
>
> Access is gated behind **Sign in with Google** (see [Sign in with Google](#sign-in-with-google)).
> Still outstanding on the cloud-sync side (see [Product vision](#product-vision)): there's no
> pull/reconcile path back from the server (today's outbox only pushes local changes).
>
> The AI features need desktop Chrome with the built-in AI flags enabled (see
> [Browser & AI requirements](#browser--ai-requirements)); without them the app degrades to
> manual entry rather than breaking.

---

## Quickstart

### Prerequisites

- **Node.js 20+** (developed on Node 22; CI runs Node 24) and **npm 10+**.
- A **Chromium-based browser** to run the app. The on-device AI features additionally require
  desktop **Google Chrome** with the built-in AI APIs enabled — see
  [Browser & AI requirements](#browser--ai-requirements).

### Install

```bash
npm install
```

This also runs the `prepare` script, which points git at the repo's hooks
(`git config core.hooksPath .githooks`) so the pre-commit and pre-push gates are active locally.

### Run, build, and verify

| Command           | What it does                                                                   |
| ----------------- | ------------------------------------------------------------------------------ |
| `npm run dev`     | Start the Vite dev server with hot-module reload (default: http://localhost:5173). |
| `npm run build`   | Type-check with `tsc -b` (project references), then produce a production build in `dist/`. |
| `npm run preview` | Serve the built `dist/` locally to sanity-check the production bundle.          |
| `npm test`        | Run the Jest test suite (jsdom + Testing Library).                              |
| `npm run lint`    | Run ESLint over the whole repo.                                                 |
| `npm run lint:complexity` | Run the strict complexity limits (nested ifs, cyclomatic, length).      |
| `npm run typecheck` | Type-check the app (`tsc -b`).                                                |

For a typical loop: `npm run dev` to work, then `npm test && npm run build` before committing.

### Running the backend (required for photo attachments)

`npm run dev` alone runs Logbook entirely against the browser's own IndexedDB — text entries are
created, edited, and read with zero extra setup. Photo attachments are the exception: they have
**no local durable store of their own**, only a transient offline queue
(`src/lib/sync/outboxQueue.ts`) that holds each photo until the backend confirms the upload. With
no backend reachable, an added photo stays queued indefinitely and is never actually saved
anywhere — it's only as durable as that IndexedDB queue, which isn't meant to be permanent
storage.

To make photo attachments actually persist, run the backend alongside the frontend:

```bash
docker compose up --build   # from the repo root: Postgres + the NestJS backend on :3000
npm run dev                 # in another terminal — vite.config.ts proxies /api -> localhost:3000
```

See [`docs/INFRASTRUCTURE.md`](docs/INFRASTRUCTURE.md) → "Optional local backend infra" for the
full Compose setup and → "Backend authentication" for the server's auth settings. The app opens
behind a Google sign-in screen, so you also need the one-time Google setup below.

### Sign in with Google

Authentication is the **backend's** responsibility, so the app has no login flag and no client ID of
its own. On start it asks the server which login it wants (`GET /auth/config`, public) and caches the
last good answer:

| Server answers | App mode | What you get |
| --- | --- | --- |
| `{ "methods": [] }` (login off) | `none` | Local-only: no sign-in screen, no banner, no Google script, no `/auth/me`, and the sync queue is held back. Settings says "Local only · sign-in is off on this server"; the timeline says sync is off. |
| `{ "methods": [{ "type": "google", "clientId": "…" }] }` | `google` | A mandatory Google sign-in (below), using the client ID the server gave. |
| nothing (offline, down, 5xx, old server) and nothing cached | `unknown` | The app opens local-only rather than trapping an offline user, and asks again when the connection returns, then switches to `google` or `none`. |

The type of login is configured **on the server** (`GOOGLE_AUTH_ENABLED`, plus the client ID and
allowlist; see `docs/INFRASTRUCTURE.md`). Nothing about it is set in the frontend build or `.env`.
`npm run dev:mocked` keeps skipping all of this (sample data, no backend).

With `google` on, Logbook opens only for a signed-in user. The sign-in screen
(`src/screens/LoginScreen.tsx`) renders Google's own button; the backend verifies the ID token
(`POST /auth/google`) and starts a session. One-time Google setup, for whoever runs the server:

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), configure the
   OAuth consent screen, then create an **OAuth client ID** of type **Web application**.
2. Under **Authorized JavaScript origins**, add every origin the app is served from, for example
   `http://localhost:5173` for `npm run dev` and your production origin. No redirect URIs are
   needed: the button hands an ID token back to the page, not through a redirect.
3. Give the client ID to the **server** (its environment); the app learns it from `GET /auth/config`.
   A client ID is public by design.

**Offline.** The first sign-in needs a connection (Google's script loads from Google). After that
the signed-in profile is cached on the device, so reopening Logbook with no signal goes straight to
your entries (so does an existing logbook that predates sign-in). If the session expires while
you're using the app, a "Sign in again to resume syncing" banner appears instead of kicking you out,
so a half-written entry survives; your local entries and the sync queue are left untouched. Signing
out works offline too and is remembered until the server confirms it. Signing in as a different
Google account on the same device asks first, because it removes the previous account's entries from
that device. If the server later says login is off, the app goes local-only and leaves the cached
profile and your entries untouched.

---

## Browser & AI requirements

Logbook runs **locally in desktop Google Chrome** (Canary/Dev/Beta track most reliable). The
**planned** AI features use Chrome's built-in, on-device Gemini Nano — which is gated behind
`chrome://flags` and a one-time model download. Because this app is run locally, enabling these
flags in your own Chrome is the intended setup. There's no hardware bar you can't bypass (see the
`optimization-guide` flag below), and no origin-trial token is needed for `localhost`.

### Required Chrome flags

Open `chrome://flags`, set each of these, then **relaunch Chrome**:

| Flag (`chrome://flags/#…`)               | Set to                        | Enables                                  |
| ---------------------------------------- | ----------------------------- | ---------------------------------------- |
| `optimization-guide-on-device-model`     | **Enabled BypassPerfRequirement** | Allows the Gemini Nano model to download regardless of hardware perf class. |
| `prompt-api-for-gemini-nano`             | **Enabled**                   | The Prompt API (`LanguageModel`) — structured extraction & NL search. |
| `rewriter-api-for-gemini-nano`           | **Enabled**                   | The Rewriter API (`Rewriter`) — polished story rewriting. |

> Voice capture uses the browser's **Web Speech API**, which needs no flag (note that Chrome's
> speech recognition may route audio to a network service — acceptable for local dev use).

### Download the model and verify

1. After relaunching, open `chrome://components` and check **"Optimization Guide On Device
   Model"** — click *Check for update* to trigger/finish the ~2 GB download. `chrome://on-device-internals`
   shows model/download status if you need to debug.
2. Confirm the APIs are live in DevTools console:
   ```js
   await LanguageModel.availability()  // → "available" once the model is downloaded
   await Rewriter.availability()       // → "available"
   ```
   `"downloadable"`/`"downloading"` means the model isn't ready yet; `"unavailable"` means a flag
   or hardware/OS requirement isn't met.

> Flag names and API shapes for Chrome built-in AI still change between Chrome versions. If a flag
> above isn't found, search `chrome://flags` for "gemini nano" and check the current
> [Chrome built-in AI docs](https://developer.chrome.com/docs/ai/built-in). When any capability
> reports unavailable, the app is designed to fall back to manual entry rather than block the user.

---

## Browser AI best practices

Chrome's built-in AI is **flag-gated, download-gated, and hardware-gated** — on any given
machine it may simply not be there. The house rule that follows from that:

> **AI unavailability must never block entry creation.** Every AI call is an enhancement over a
> path that already works without it.

Concretely, all on-device AI work in this repo follows the pattern established in `src/lib/ai/`:

1. **Check availability before creating a session.** `lib/ai/availability.ts` is the single place
   that probes `LanguageModel` / `Rewriter` / `SpeechRecognition`. Every check starts with
   `typeof X === 'undefined'`, so the code is safe in jsdom and in any non-Chrome browser.
   `'downloadable'` and `'downloading'` are treated as usable — `create()` triggers the download.
2. **Degrade, don't throw.** When a capability is unavailable the flow skips it and lands on a
   manual path: the review step opens with an editable story seeded from the raw text, and search
   falls back to plain substring matching. A call that *is* attempted and fails anyway — a
   `QuotaExceededError`, an over-long transcript — is caught at the call site in
   `useNewEntryFlow`, which falls back to the same manual path instead of surfacing an
   unhandled rejection. (`parseSearchQuery` goes further and never throws at all.)
3. **Never trust the model's output shape.** Structured output via `responseConstraint` is
   best-effort: `extractEntry` recovers a `{…}` block from a noisy response, validates the `shape`
   enum, and falls back to a derived value instead of trusting `JSON.parse`.
4. **Always release sessions.** Every `create()` is paired with a `destroy()` in a `finally`, and
   in-flight work is cancellable via `AbortSignal` so closing the overlay doesn't leak a session
   or write state after unmount.
5. **Run on-device models sequentially.** Gemini Nano is a single local model; concurrent sessions
   can contend on low-end hardware, so extraction and rewriting run one after the other.
6. **Wrap the globals.** Screens and hooks never touch `LanguageModel`/`Rewriter` directly — only
   `src/lib/ai/*` does, which is what keeps an API-surface change a one-file edit.
7. **Announce async state.** Capture/processing steps and live transcripts are exposed through
   `aria-live` regions, since an AI round-trip is invisible to a screen-reader user otherwise.

---

## Project structure

```
src/
  App.tsx                # Root component: wires screens + overlays via useLogbookApp
  main.tsx               # React entry point (mounts <App /> under StrictMode)
  types/                 # Shared models (Entry) + ambient decls for APIs the DOM lib lacks
  data/                  # One-time seed data for an empty store
  hooks/                 # useLogbookApp (composition root), useNavigation, useEntries,
                         #   useNewEntryFlow, useSpeechCapture, useExportActions,
                         #   useSyncOutbox, useEntryAttachments
  lib/
    ai/                  # Chrome built-in AI wrappers: availability, extractEntry,
                         #   rewriteStory, searchEntries
    db/                  # entriesStore, outboxStore, syncStateStore, identityStore, localOwner — IndexedDB wrappers
    auth/                # googleIdentity (Google Identity Services wrapper), authConfig (the
                         #   server's login config), sessionFlows (the sign-in gate's decisions)
    backup/              # JSON snapshot export/import (File System Access)
    export/              # Markdown + printable-PDF formatters
    sync/                # Backend HTTP client (entriesApi, attachmentsApi, authApi, health)
                         #   + the offline outbox (outboxQueue, outboxRunner)
    …                    # Pure helpers: buildEntry, computeStats, filterEntries, cx
  screens/               # Full-screen views: Timeline, Search, Stats, Settings, + overlays
  components/            # Reusable UI: TabBar, EntryCard, badges, glyphs, placeholders
public/                  # Static assets: app icons + PWA icon set
server/                  # Separate NestJS + Postgres backend package — see docs/INFRASTRUCTURE.md
```

Each unit of logic has a co-located `*.test.ts(x)` file. Build tooling: **Vite** +
`@vitejs/plugin-react` + `vite-plugin-pwa` (manifest + Workbox service worker). TypeScript is
split via project references (`tsconfig.app.json` for app code, `tsconfig.node.json` for
Node-side config).

All browser-API access is funnelled through the thin wrappers in `lib/ai`, `lib/db`,
`lib/backup`, and `lib/export`, so the screens never touch a flag-gated global directly — and a
shifting origin-trial surface only ever breaks one file.

For the reasoning behind these choices (why IndexedDB, why on-device AI, why this hook
composition instead of a global store) see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). For
CI, git hooks, and the build/PWA pipeline, see [`docs/INFRASTRUCTURE.md`](docs/INFRASTRUCTURE.md).

---

## Testing

The project follows **Test-Driven Development**: write the failing Jest test for a behavior
first, then the minimum code to pass, then refactor. Every function — frontend or backend — must
have a unit test, added or updated in the same change. Tests are never deleted to make a change
land; if a test is genuinely obsolete, that removal is called out and justified explicitly.

```bash
npm test              # full suite
npm test -- --watch   # watch mode while developing
```

---

## Contributing / git workflow

- Work on a feature branch (`feat/…`, `fix/…`, `chore/…`), never directly on `main`.
- Commits must follow **Conventional Commits**; the `.githooks/commit-msg` hook enforces the
  subject format, `.githooks/pre-commit` gates every commit on **typecheck → lint → complexity → tests**, and
  `.githooks/pre-push` re-checks them plus diff-aware coverage against `origin/main`.
- Open a PR against `main`. CI runs the static gates automatically; they must be green before
  merge.

`CLAUDE.md` is the deeper development guide for contributors and AI coding assistants; see
`docs/AGENTIC_WORKFLOW.md` for how this repo's Claude Code agents/skills/MCP integrations carry a
feature from request to merged PR.

---

## Product vision

The sections below describe the intended product. Everything here is implemented except the
sync gap called out explicitly below (no pull/reconcile sync).

### Core features

- **Voice capture** — Web Speech API converts speech to text so an entry can be created entirely
  by voice.
- **Structured data extraction** — the Prompt API turns free-form text into structured fields:
  activity type (skydiving, hiking, climbing, trekking, …), location, date, weather, equipment,
  route/climb grade, jump altitude, duration, difficulty, participants, personal notes, and
  adrenaline/effort level.
- **AI rewriting** — the Rewriter API transforms rough notes into a polished first-person
  adventure story suitable for a journal or sharing.

  > _Input:_ "I climbed Pico da Bandeira today. Really windy. Used helmet and ropes. Exhausting but worth it."
  > → a well-written first-person adventure story.

### Offline-first principles

Offline **capture** stays non-negotiable — this is a field app, and its users are out of coverage
at precisely the moment they want to log an entry. What changed is which copy of the data is
authoritative: see [issue #23](https://github.com/viniciuspassos/logbook/issues/23).

The application must:

- Work completely offline — the app shell is precached by the service worker, so a cold start
  with no network serves the full UI and every cached entry.
- Let entries be created and read with no network, always. A capture that can't reach the server
  completes locally and queues.
- Cache application assets with a **service worker** (Workbox, via `vite-plugin-pwa`).
- Never require cloud AI services for core functionality.
- Treat the **server as the source of truth**, with **IndexedDB** (`src/lib/db/entriesStore.ts`)
  as the local read cache and write queue.
  _Partially implemented_ ([#26](https://github.com/viniciuspassos/logbook/issues/26)) — a
  background outbox (`src/lib/sync/`) pushes creates, updates, deletes, and attachment uploads to
  the backend whenever it's reachable. IndexedDB is still authoritative in shipped code, though:
  there's no pull/reconcile path back from the server yet, a version conflict
  ([#24](https://github.com/viniciuspassos/logbook/issues/24)) is left queued rather than
  auto-resolved. Access is gated behind Sign in with Google.

> One caveat on "completely offline": Chrome's **Web Speech API** may route audio to a network
> service, so voice capture specifically can require connectivity. Extraction, rewriting, search,
> and storage are all genuinely on-device.

### Additional features

Timeline of adventures · full-text and **AI-powered natural-language** search · statistics
dashboard · export to Markdown · export to PDF (via the browser's own print-to-PDF, no PDF
library) · local backup export/restore via the File System Access API · photo attachments
(queued locally, uploaded to the backend via the offline outbox) · deleting an entry, or removing
just one of its photos, with an inline confirmation (also synced through the outbox).

### Tech stack

TypeScript · React · Vite · PWA (service worker + manifest) · IndexedDB · Web Speech API ·
Browser Prompt API · Browser Rewriter API · File System Access API · NestJS + Postgres (backend
sync, `server/`).

### Development principles

- Prefer native browser APIs over third-party libraries.
- Keep AI processing entirely on-device whenever possible.
- Favor simple, maintainable, modular, reusable code.
- Use strict TypeScript and functional React components.
- Document non-obvious decisions; keep the project easy for humans and AI assistants to follow.

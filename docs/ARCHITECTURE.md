# Architecture

This document explains **how Logbook is put together and why**, at a level of detail below
`README.md` (project overview, quickstart, product vision) and above the per-file comments in
`src/`. Read it after the README's [Project structure](../README.md#project-structure) section.
It's aimed at a new contributor or an AI coding assistant that needs to make a change without
re-deriving the design from scratch.

## Guiding constraint

Logbook's product requirement — usable with no connectivity, in the field — drives almost every
decision below. **Nothing on the primary capture → save path may depend on the network.**
Voice capture, AI extraction/rewrite, and search are all *enhancements*; storage and the app shell
are not allowed to be. See `README.md` → "Browser AI best practices" for the detailed rules this
implies for AI code specifically; this document covers the rest of the app.

This constraint **survives** the server-canonical decision below. A capture with no network still
completes locally and queues. What changed is *which copy is authoritative*, not *whether you can
write offline*.

### Source of truth: server-canonical (decided, partially built)

Per [issue #23](https://github.com/viniciuspassos/logbook/issues/23), the target architecture is
**the server owns the truth; IndexedDB is a local read cache and write queue**. This reverses the
original design, in which IndexedDB *was* the truth and the network did not exist at all.

**Current state: push-only outbox, IndexedDB still authoritative.**
[#26](https://github.com/viniciuspassos/logbook/issues/26) landed `src/lib/sync/` — a backend HTTP
client (`entriesApi`, `attachmentsApi`, `authApi`, `health`) — and an offline outbox
(`outboxQueue`/`outboxRunner`, driven by the `useSyncOutbox` hook) that pushes entry
creates/updates/deletes and attachment uploads to the backend added in #17 whenever it's reachable,
no-op'ing silently otherwise. Two things separate this from the target architecture above:

- **No pull/reconcile path.** The client only ever pushes local changes; it never fetches server
  state back down, so a second device's writes or a server-side edit are invisible locally. A
  version conflict ([#24](https://github.com/viniciuspassos/logbook/issues/24)) is left queued with
  its error recorded rather than auto-resolved — there's no manual-resolution UI yet.

Sign-in is covered in "Authentication: Sign in with Google" below.

**Drain policy: stop on transient failures, park permanent rejections.** `outboxRunner` drains
strictly FIFO, which is what guarantees an entry's create lands before any op that needs its server
id. A transient failure (offline, 5xx, 401/403, a #24 409) stops the drain and the op is retried
next time. A **permanent** rejection (any other 4xx, e.g. a 413 photo or a 400 payload) would fail
identically forever, and stopping on it pinned the whole queue behind it
([#91](https://github.com/viniciuspassos/logbook/issues/91)). So such an op is parked
(`rejected: true`) and the drain moves on. Ops for an entry whose create was parked are parked
too (they could never resolve a server id), so ordering still holds. The drain then reports
`'rejected'` (timeline: "some changes rejected"), and a parked photo shows its reason in the
gallery with a Remove button. Parked ops are never auto-retried: the server already said no.
There is no UI yet to discard a parked *entry* create/update — only photos.

Read this section as the current midpoint, not the end state — `entriesStore.ts` is still what
every screen reads from.

## Data flow, end to end

```
 User speaks or types
        │
        ▼
 useSpeechCapture ──(final transcript)──► useNewEntryFlow.processRaw()
        │                                        │
        │                          ┌─────────────┴─────────────┐
        │                          ▼                            ▼
        │                 lib/ai/extractEntry          lib/ai/rewriteStory
        │                 (Prompt API, sequential)      (Rewriter API, sequential)
        │                          │                            │
        │                          └─────────────┬─────────────┘
        │                                        ▼
        │                              draft { raw, extracted, story }
        │                                        │
        │                                   review step (edit)
        │                                        │
        │                                        ▼
        │                          useLogbookApp.saveEntry()
        │                                        │
        │                          lib/buildEntry.buildEntryFromDraft()
        │                                        │
        │                                        ▼
        │                              useEntries.addEntry()
        │                             ┌──────────┴───────────┐
        │                             ▼                      ▼
        │                    React state (immediate)   lib/db/entriesStore
        │                                               (IndexedDB, write-through)
        ▼
 (falls back to typed text if speech/AI unavailable at any step)
```

Two properties of this flow are load-bearing and easy to break by accident:

- **AI calls are sequential, never parallel.** Gemini Nano is a single on-device model; running
  extraction and rewriting concurrently can contend for it on low-end hardware. `processRaw` in
  `src/hooks/useNewEntryFlow.ts` awaits extraction, then rewriting.
- **The UI state update is optimistic; the store write is not on the critical path.**
  `useEntries.addEntry` updates React state synchronously and fires the IndexedDB write
  fire-and-forget (`.catch(() => {})`). A slow or failing write must never stall the UI. The one
  exception is `replaceEntries` (backup restore), which *does* await the write and lets failures
  propagate — a restore that silently didn't stick would be worse than a visible error. The same
  applies one layer further out: `saveEntry` (`useLogbookApp.ts`) calls `useSyncOutbox`'s
  `queueEntryCreate` right after `addEntry`, also fire-and-forget — queueing (and the drain it
  triggers) never blocks the save or the UI. A restore does the same with `queueEntryCreates`, but
  only *after* the awaited `replaceEntries` succeeds, so entries that didn't persist locally never
  sync; re-queuing is safe because the runner no-ops a create whose local id already has a server id.
- **Deletes follow the same local-first shape.** `deleteEntry` (`useLogbookApp.ts`) closes the
  overlay, drops the entry from state and IndexedDB (`useEntries.removeEntry`, fire-and-forget), then
  calls `useSyncOutbox.queueEntryDeletion`. That removes every op still queued for the entry (its
  create, edits, photo uploads) and queues a `delete-entry` — even if the entry never synced, since
  a drain already in flight may still be creating it; the delete then runs after that create, and
  no-ops if there's nothing on the server. The server tombstones the entry and purges its photos.
  Removing a single photo (`useEntryAttachments.removePhoto`) drops its queued upload if it never
  reached the server (`discardRejectedOperation`), or queues a `delete-attachment` op.
  `getEntryAttachmentSources` hides photos with a pending (not rejected) delete, so the gallery
  updates straight away even offline.
- **The runner re-checks each op before running it.** A pass reads the queue once, so it skips any
  op removed since (the user deleted its entry or photo), and an upload that finishes after its op
  was removed is deleted from the server again. Both deletes treat a 404 as already done instead of
  parking it as a permanent rejection. A photo the server rejected keeps its own Remove button
  (`discardPhoto`), so no tile shows two.
- **Local entry ids are never reused.** `nextEntryId` (`lib/buildEntry.ts`) mints
  `max(highest id + 1, Date.now())` rather than plain `max + 1`. The id is the outbox's and the
  sync-state map's key, so reusing a deleted newest entry's id would hand the new entry the deleted
  one's server mapping and photos.

### Authentication: Sign in with Google (decided, built)

[Issue #122](https://github.com/viniciuspassos/logbook/issues/122) replaced the shared-password
login (which had no UI) with **Sign in with Google**, the only method. The backend verifies a
Google ID token (`POST /auth/google`), allowlists accounts, and starts a session cookie;
`GET /auth/me` says who a session belongs to. On the client:

- `src/lib/auth/googleIdentity.ts` is the only module that touches Google Identity Services. It
  lazy-loads `accounts.google.com/gsi/client`, renders Google's button, and degrades to an
  "unavailable" result offline instead of throwing. The OAuth client ID comes from
  `window.__LOGBOOK_GOOGLE_CLIENT_ID__` (`src/lib/auth/config.ts`), not `import.meta.env`, for the
  same Jest/Babel reason as `src/lib/sync/config.ts`.
- `useAuth` owns `state` (`'loading' | 'signedIn' | 'signedOut'`), the `profile`,
  `signInWithGoogle` and `logout`. `App.tsx` renders `LoginScreen` while `signedOut`. It is a gate in
  `App`, not a `useNavigation` overlay, because nothing else in the shell should be reachable
  behind it.
- `src/lib/db/identityStore.ts` caches the last signed-in profile in IndexedDB.

**The gate versus the offline rule.** The offline-first rule says creating and reading entries must
work with no network. A mandatory login is in tension with that, so the gate applies only when
there is **no known identity**:

- *Cached identity present* (any earlier successful sign-in on this device): the app opens
  immediately, with or without a network. `GET /auth/me` then runs in the background, and only a
  401 from it, or from a sync drain, returns to the gate.
- *A 401 never touches local data.* Entries, photos and the outbox stay exactly as they were; only
  the way into the app changes. The cached identity is kept too, so the app still opens offline
  afterwards. Only an explicit **Sign out** clears it.
- *First sign-in needs a network.* This is unavoidable: Google and the backend both have to be
  reached once. With no cached identity and no connection the screen says it couldn't reach Google
  and offers a retry.

Why: a hard gate that also required a live check on every open would lock a signed-in climber out
of their own logbook on a mountain, which is the product's core scenario. The cache is not a
security boundary (the session cookie is what authorises sync), so keeping the profile for offline
reopening gives nothing to someone holding the unlocked device that they didn't already have.

## State composition

`useLogbookApp` (`src/hooks/useLogbookApp.ts`) is the composition root. It owns **no state of its
own** beyond a couple of coordinating functions (`openNewEntry`, `closeOverlay`, `saveEntry`, `deleteEntry`) —
everything else is delegated to a single-concern hook:

| Hook | Owns |
| --- | --- |
| `useNavigation` | Active tab, open overlay, timeline view mode, selected entry |
| `useEntries` | The persisted entry list: load-on-mount, seed-if-empty, write-through on add/replace |
| `useNewEntryFlow` | The capture → listening → processing → review state machine, speech, AI orchestration |
| `useExportActions` | Markdown/PDF export, JSON backup export/restore, a `busy` guard and status message |
| `useSyncOutbox` | Registers the reconnect trigger and does a mount-time drain against the backend outbox; exposes `queueEntryCreate`, `queueEntryCreates` (backup restore), `queueEntryDeletion` and the timeline's `syncStatus`, read from every finished drain via `subscribeToDrains` |
| `useAuth` | Who is signed in (Sign in with Google): `state`, `profile`, `signInWithGoogle`, `logout`; resolved on mount from the cached identity plus `GET /auth/me`. `App.tsx` gates on it |
| `useEntryAttachments` | The attachment gallery (server-confirmed + locally-queued photos) for whichever entry is open, the upload flow, and removing a single photo |

**Why this shape instead of one hook, or a global store (Redux/Zustand):** the app has several
genuinely independent concerns (routing-ish UI state, persisted domain data, a multi-step capture
wizard, export side effects, and the additive server-sync/attachment concerns) that rarely need to
read each other's internals — `useLogbookApp`
is the only place that wires them together, and it does so through plain function calls, not a
shared store. Adding new state should extend the hook that owns that concern, or introduce a new
one — see `CLAUDE.md` → "State composition" for the explicit rule against growing
`useLogbookApp` back into a god hook.

### The new-entry state machine

`useNewEntryFlow` steps through four states: `capture → listening → processing → review`.
`abort()` (closing the overlay) and `reset()` (starting over) both cancel in-flight AI work via
`AbortController` rather than letting a stale response land after the user has moved on. An
`AbortController` is recreated per processing run (`beginProcessing`); a `mountedRef` additionally
guards against state updates after unmount. Regenerating the story (`regenerateStory`) reuses the
same cancellation path and bumps a `variantRef` so repeated regenerations don't collapse to the
same Rewriter output.

## Layering: why browser APIs are never touched directly in screens/hooks

Every flag-gated or otherwise unstable browser API is wrapped in a thin, independently-tested
module, and only that module touches the global:

- `src/lib/ai/` — `availability`, `extractEntry`, `rewriteStory`, `searchEntries` (Prompt +
  Rewriter APIs)
- `src/lib/db/` — IndexedDB: `entriesStore.ts` (entries), `outboxStore.ts` (pending sync ops),
  `syncStateStore.ts` (local-id ↔ server-id/version mapping)
- `src/lib/backup/` — File System Access (JSON snapshot export/import)
- `src/lib/export/` — pure Markdown/printable-HTML formatters (no browser API — deliberately pure
  so they're trivial to unit test)
- `src/lib/sync/` — the HTTP client for the `server/` backend (`httpClient`, `entriesApi`,
  `attachmentsApi`, `authApi`, `health`) plus the offline outbox (`outboxQueue`, `outboxRunner`)

**Why:** Chrome's built-in AI APIs are an active origin trial — flag names, method shapes, and
capability strings have already changed between Chrome versions during this project's life. If
`screens/` or `hooks/` called `LanguageModel.create()` directly, an API change would mean hunting
through UI code for every call site. Because only `lib/ai/*` touches the global, an API-surface
change is a one-file edit, and every wrapper's jsdom-safety (`typeof X === 'undefined'` guards) is
tested once at the boundary instead of re-verified at every call site.

The same reasoning applies one level down to `lib/export/entryFields.ts`: it's the single place
that defines which `Entry` fields appear in an export and in what order, so Markdown and PDF
export can't drift apart by one of them forgetting a field the other added.

## Visual design: the "Dropzone" direction

The UI's look comes from the skydiving half of the audience: open sky as the page
(`--lb-page-bg`), cloud-white surfaces (`--lb-bg`), navy ink (`--lb-ink`), and canopy orange
(`--lb-accent`) as the one accent. Headings use Archivo's expanded width (`--display`,
`font-stretch: 125%`), and body text stays on the system sans. It replaced
([#113](https://github.com/viniciuspassos/logbook/issues/113)) an "open logbook" desktop
layout: a leather spine rail and two cream pages with terracotta and serif type. That design
read as generic, and the book metaphor made the list look like a page instead of a list.

- **Tokens are the only source of colour.** Every colour is a `--lb-*` token in
  `src/index.css`, with a dark ("night sky") value for each. The manifest/`theme-color` values
  and the standalone PDF stylesheet (`src/lib/export/printDocument.ts`, which can't read CSS
  variables) mirror them by hand.
- **The bright orange never carries small text.** `#ff5b1f` is about 3:1 on white. It's for
  icons and shapes only. Orange text uses `--lb-accent-ink`, and a button with a text label
  sits on `--lb-accent-fill` with `--lb-on-accent` text. Both pass WCAG AA in light and dark.
- **Desktop is three columns:** the navy nav rail, the list on the sky, and a white reading
  panel. The list row of whichever entry the panel shows is marked (`aria-current`, from
  `App` → `TimelineScreen` → `EntryCard`) and turns panel-white, running flush into the panel,
  so list and panel read as one surface. Mobile keeps its single-column layout.
- **Fonts are self-hosted** (`src/assets/fonts/`) so the PWA renders them offline. Archivo
  ships as one variable latin-subset woff2 that covers every weight and width.
- **App icons** (`public/*.png`) are rendered from `public/icon.svg` with
  [`@resvg/resvg-js`](https://github.com/yisibl/resvg-js). The maskable and Apple touch icons
  use a square-cornered background because the OS crops them to its own shape.

## Key architectural decisions

| Decision | Alternative considered | Why this one |
| --- | --- | --- |
| **Server-canonical, IndexedDB as cache + write queue** ([#23](https://github.com/viniciuspassos/logbook/issues/23)) | Keeping IndexedDB authoritative with the server as an optional backup target; or dropping offline support entirely | Optional-backup left the server permanently second-class and made multi-device sync impossible. Dropping offline was genuinely simpler — it closes the conflict problem outright — but the audience is out of coverage at the exact moment they log an entry, so it removes the product's reason to exist. Server-canonical keeps field capture working while making the server meaningful. Cost accepted knowingly: this is the *most* engineering of the three, and still owes a write queue and conflict semantics ([#24](https://github.com/viniciuspassos/logbook/issues/24)). |
| **Postgres** for server-side persistence ([#25](https://github.com/viniciuspassos/logbook/issues/25)) | SQLite | SQLite is meaningfully simpler to operate — one file, no container, trivial backups — and was the right question to ask, because when Postgres was first chosen its justification was *speculative*: multi-writer and sync headroom that nothing actually used. Two later decisions made that headroom real. [#23](https://github.com/viniciuspassos/logbook/issues/23) put multiple devices reconciling write queues against one server (the multi-writer case), and [#18](https://github.com/viniciuspassos/logbook/issues/18) put the session store in Postgres, so auth depends on it too. SQLite's single-writer model now sits badly with both. Cost accepted: a second container and heavier local dev than a file would be. |
| **IndexedDB** for persistence (`lib/db/entriesStore.ts`) | `localStorage` | Entries carry structured fields plus media placeholders; `localStorage`'s string-only, ~5MB, synchronous API doesn't scale to that and blocks the main thread. IndexedDB is async and has no practical size ceiling for this use case. |
| **On-device AI** (Chrome Prompt/Rewriter APIs) over a cloud LLM | Calling an LLM API over the network | The core product requirement is working with no connectivity. A cloud call is a hard dependency the app can't have on its capture path. The cost is real: the feature is flag-gated, download-gated, and desktop-Chrome-only — accepted deliberately, with unavailability always degrading to a manual path (see `README.md` → "Browser AI best practices"). |
| **Sign in with Google**, a mandatory gate that stays open offline from a cached identity ([#122](https://github.com/viniciuspassos/logbook/issues/122)) | A shared password; an optional, Settings-only sign-in; a gate that re-checks the server on every open | A shared password has no per-user identity, which the backend's per-user data scoping needs, and it never had a UI. An optional sign-in left sync permanently 401ing. A gate that must reach the server on every open breaks offline-first. Google needs no password storage on our side. The cost: the first sign-in needs a network, and the Google script is a third-party dependency (isolated in `lib/auth/googleIdentity.ts`). |
| **Composed single-concern hooks**, no global store | Redux/Zustand/Context-as-store | Several concerns (nav, entries, new-entry flow, export, server-sync, attachments) that don't need cross-cutting selectors or middleware. A composition-root hook keeps the wiring visible in one function instead of behind a store's action/reducer indirection. |
| **`vite-plugin-pwa` with `generateSW` + `registerType: 'autoUpdate'`** | `injectManifest` (custom service worker logic), or prompting the user to refresh | Logbook is a single-user personal log with no server contract to coordinate (no "your data is stale, refresh" concern), so silently activating the newest build is safe and avoids nagging the user with an update prompt. `devOptions.enabled: true` additionally serves the service worker under `npm run dev`, not just a production build, so offline behaviour is exercisable without a separate `preview` step. |
| **File System Access API for local JSON backup**, kept alongside the [#26](https://github.com/viniciuspassos/logbook/issues/26) backend outbox | Treating the backend outbox as the only durability path | The outbox only pushes best-effort and has no pull/reconcile path or login UI yet (see "Source of truth" above), so it isn't a substitute for a user-controlled escape hatch. Local JSON backup stays the durable, portable fallback that doesn't depend on a reachable server or a signed-in session. |
| **Co-located `*.test.ts(x)` files, TDD, one test per function** | A separate `__tests__` tree, or partial coverage | Keeps a test physically next to the code it exercises so it's never orphaned by a rename, and makes "does this file have a test" a one-glance check. Enforced by `CLAUDE.md` and the pre-commit hook running the full suite on every commit. |
| **TypeScript project references** (`tsconfig.app.json` / `tsconfig.node.json`) | A single flat `tsconfig.json` | Separates app code (bundler resolution, DOM lib, strict unused-checks) from Vite's own Node-side config (Node lib, different module target) so each gets the right ambient types without leaking into the other. |
| **Ambient ` src/types/*.d.ts` declarations** for Speech/Chrome-AI/File-System-Access APIs | `@types/*` packages or `any` | These APIs aren't in the DOM lib and don't have stable published types (some are origin-trial-only). Hand-written ambient declarations, scoped to exactly what the app calls, keep `any` out of the codebase per the ESLint policy in `CLAUDE.md`. |

## Where to look next

- **Adding a browser-API-backed feature?** Start in the matching `src/lib/*` wrapper, write its
  test first (TDD, see `CLAUDE.md` → Testing), then wire it into the owning hook.
- **Adding UI state?** Decide which hook in [State composition](#state-composition) owns the
  concern before touching `useLogbookApp`.
- **CI, git hooks, and the PWA build** are covered in
  [`docs/INFRASTRUCTURE.md`](INFRASTRUCTURE.md), not here.

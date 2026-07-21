# Agentic development workflow

This document explains **how a feature gets built and shipped in this repo when Claude Code is
doing the work** — which subagents pick up which kind of request, which skills gate a commit, and
which MCP-backed integrations are involved. Read it alongside `CLAUDE.md` (the conventions the
agents below all enforce) and `docs/INFRASTRUCTURE.md` (what CI actually re-checks). It's aimed at
whoever is configuring or reasoning about the `.claude/` setup itself, not at the product.

## Agents (`.claude/agents/`)

Five subagents are defined for this repo. Each has its full routing logic in its own frontmatter
`description` (Claude Code uses that to pick an agent automatically) — this is the short version:

| Agent | Scope | Writes code? |
| --- | --- | --- |
| `product-engineer` | Orchestrates the other three for cross-cutting work (a feature spanning frontend+backend+infra, a full validation sweep); holds product context from `README.md` | **No** — `.md` files only, everything else is delegated |
| `frontend-engineer` | React/TypeScript client (`src/`) — hook-composition and layering rules from `CLAUDE.md` | Yes |
| `backend-engineer` | Node/TypeScript service (`server/`) — NestJS by default, Express for genuinely simple services | Yes |
| `devops-engineer` | Docker/Compose (local-only, no cloud target) and GitHub Actions CI | Yes |
| `qa-release-gate` | Live smoke test of the running app before a release cut — not per-commit | No (Bash/Read/Write for its own report only) |

A request scoped to one layer goes straight to that layer's specialist (`frontend-engineer`,
`backend-engineer`, `devops-engineer`) — routing it through `product-engineer` first just adds a
hop. `product-engineer` is for requests that genuinely span layers or need product framing (e.g.
"plan cloud sync end to end") and is a **pure orchestrator**: it never edits `.ts`/`.tsx`/config/
YAML itself, only dispatches the three implementing agents via the `Agent` tool and synthesizes
their reports.

`qa-release-gate` is qualitatively different from the other four: it doesn't implement anything,
it drives the already-built app in a real browser and reports GO/NO-GO. It's invoked on demand
("QA this before we ship", before tagging a release) — see "How tests fit in" below for why it's
not part of the standard per-feature loop.

## Skills (`.claude/skills/`)

Three repo-local skills carry the mechanical parts of shipping a change, so each agent's prompt
states policy ("run the quality gate") rather than reimplementing the steps:

- **`validate-before-commit`** — runs the real `.githooks/pre-commit` (typecheck → lint → test) and
  `.githooks/commit-msg` (Conventional Commits) via `git hook run`, rather than a hand-rolled
  reimplementation of those checks.
- **`code-reviewer`** — the single quality gate before a commit. Dispatches a dedicated **Opus**
  subagent (via the `Agent` tool, `subagent_type: "general-purpose"`, `model: "opus"`) to review
  the diff against `main` for, in order: (1) every changed/added function has a real Jest test —
  `CONFIRMED` by default if not, since `CLAUDE.md`'s TDD rule removes the ambiguity; (2) SOLID/
  YAGNI/DRY and this repo's layering rules; (3) a shallow correctness pass. Every specialist agent
  runs this exactly once per change, right before `ship-pr`.
- **`ship-pr`** — owns push→PR→merge: rebase onto `origin/main`, run `validate-before-commit`,
  run `code-reviewer` (skipped only for docs-only diffs — Markdown has no test coverage or SOLID
  surface to check), commit, push with upstream tracking, open the PR (using
  `.github/pull_request_template.md`), then merge with `--squash --delete-branch` as soon as
  `static-gates` is green — no per-PR confirmation needed in this repo.

All four implementing agents (`product-engineer` excluded) call these in the same order: **write
code test-first → `code-reviewer` → `ship-pr`** (which itself calls `validate-before-commit` and
`code-reviewer` again if the calling agent hadn't already run them on this exact diff).

Two plugin-provided skills exist alongside these but serve different moments, not the same gate:
`code-review` (from the `code-review` plugin) reviews an already-open GitHub PR, not a local
working diff — `code-reviewer` above is what runs pre-commit, and the two are deliberately not
stacked on the same diff. `frontend-design` is design guidance for UI work, invoked by
`frontend-engineer` when shaping new screens, not a gate.

## MCP servers and plugin integrations

Enabled plugins live in `.claude/settings.json`:

- **`github`** — the `mcp__plugin_github_github__*` tools plus `gh` CLI usage. Used throughout
  `ship-pr` (branch/PR/merge operations) and by any agent that needs to read issues (`CLAUDE.md`'s
  "Before implementing" step: search the tracker before duplicating past work).
- **`typescript-lsp`** — language-server-backed navigation (go-to-definition, find-references)
  available to any agent doing non-trivial TypeScript work, more precise than `grep` for tracing
  usages across `src/`/`server/`.
- **`code-review`** — the generic PR-review skill described above.
- **`frontend-design`** — visual/UX guidance for `frontend-engineer`.
- **`playwright`** (`mcp__plugin_playwright_playwright__*`) — real browser automation. **Scoped
  entirely to `qa-release-gate`**; no other agent's tool list includes it, and there is no
  Playwright config or spec file checked into this repo — it's agent-driven interactive browser
  control, not a committed e2e test suite. See "Does this repo still use Playwright?" below.

`claude-in-chrome` (browser automation against the user's actual Chrome session, not a fresh
Playwright-controlled browser) is a separate, general-purpose integration available in interactive
sessions — it isn't part of any agent's fixed tool list or the standard feature workflow above; a
human driving Claude Code directly might reach for it ad hoc, but no agent definition depends on it.

## End-to-end: shipping a new feature

1. **Isolate the session.** Per `CLAUDE.md` → "Before implementing": sync `origin/main`, check
   whether the current branch/working tree actually belongs to this task (stash and re-branch if
   not), and grep the codebase/issue tracker for prior work on the same behavior.
2. **Route to the right agent(s).** Single-layer request → the matching specialist directly.
   Cross-cutting request → `product-engineer`, which dispatches specialists in parallel (independent
   work) or sequentially (e.g. backend API shape before frontend integration) and synthesizes their
   reports.
3. **Implement test-first.** Each specialist follows this repo's TDD convention (failing Jest test
   → minimal implementation → refactor) and its own layering rules (frontend hook-composition,
   backend controller/service/repository, infra multi-stage builds).
4. **`code-reviewer` gate.** One Opus-reviewed pass against `main`; `CONFIRMED` findings are fixed
   before proceeding.
5. **`ship-pr`.** Validates (hooks), commits (Conventional Commits), pushes, opens the PR, waits
   for `static-gates`, squash-merges, deletes the branch — no extra confirmation for this repo.
6. **Periodically, not per-feature: `qa-release-gate`.** Before cutting a release candidate (or
   "make sure nothing's broken" after a longer stretch of work), a separate on-demand pass drives
   the real app with Playwright and reports GO/NO-GO with concrete evidence, layered on top of the
   already-green static gates from CI.

## How tests fit in

Two distinct kinds of "testing" run in this workflow, at different layers, and it's worth keeping
them separate:

- **Unit tests (Jest), enforced per commit.** `CLAUDE.md`'s TDD rule — one test per function,
  written before the implementation — is enforced twice: mechanically by `.githooks/pre-commit`
  (blocks the commit itself) and again by CI's `static-gates`/`server-static-gates` jobs
  (`docs/INFRASTRUCTURE.md`). `code-reviewer` adds a *judgment* layer on top of that mechanical
  check: a function can have a test and still fail review if that test is a tautology
  (`expect(result).toBeDefined()`) rather than asserting real behavior — a missing or hollow test
  is a `CONFIRMED` finding, not a `PLAUSIBLE` one, since the TDD rule removes the ambiguity.
- **Live browser QA (Playwright via MCP), on demand only.** `qa-release-gate` is the one agent that
  exercises the *running* app rather than reading a diff — it starts the dev server, drives it with
  the Playwright MCP tools (`browser_snapshot` preferred over screenshots, since this app uses
  semantic roles/labels rather than test IDs), and checks console/network output after each
  interaction. This catches what unit tests structurally can't: a screen that renders blank, a
  console error a passing test suite doesn't surface, a regression only visible when flows are
  chained together. It used to run in CI as a required check; `docs/INFRASTRUCTURE.md` records that
  it was **dropped from `ci-static.yml`** as unhelpful there and is invoked locally/on-demand
  instead.

### Does this repo still use Playwright?

**Yes, but only in this one place.** There's no `playwright.config.ts` and no `*.spec.ts` e2e
suite committed to the repo — Playwright shows up exclusively as the `playwright` plugin's MCP
tools (`mcp__plugin_playwright_playwright__*`), wired into `qa-release-gate`'s tool list alone. It
drives a real, ephemeral browser against `npm run dev` for an on-demand smoke test before a release
or a "make sure nothing broke" check — none of `.github/workflows/ci-static.yml`'s jobs
(`static-gates`, `server-static-gates`, `server-migrations-drift`) touch a browser or Playwright,
and no other agent has Playwright in its tool list.

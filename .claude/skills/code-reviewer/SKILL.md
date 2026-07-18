---
name: code-reviewer
description: Deep code-quality review before committing — verifies every changed/added function has a meaningful unit test and that the change holds up against SOLID, YAGNI, and this repo's layering principles, plus a shallow correctness pass. Runs as a dedicated Opus subagent for a fresh, independent read. This is the sole review step in agent workflows — an agent must call this before its first commit on a change instead of a separate generic diff review.
---

Paths below are relative to the repo root (`logbook/`).

This is the single quality gate an agent runs before committing. It
replaces ad hoc self-review: call this skill exactly once per change,
right before handing off to `ship-pr` (see Gotchas for why not to
stack it with the generic `code-review` skill).

## What this reviews, in priority order

1. **Test coverage.** Every function added or changed in the diff has
   a corresponding Jest unit test that asserts real behavior — not a
   smoke test that merely calls the function, not a tautological
   assertion (`expect(result).toBeDefined()` alone, no meaningful
   input/output check). `CLAUDE.md` requires TDD and one test per
   function in this repo — a changed function with no test, or a test
   that doesn't exercise its actual logic/edge cases, is a `CONFIRMED`
   finding by default, not a judgment call.
2. **Architecture principles.**
   - **SOLID** — single-responsibility violations (a function/hook/class
     doing two unrelated things), concrete dependencies where a thin
     abstraction would decouple cleanly, interfaces or props forced on
     callers that don't need them.
   - **YAGNI** — speculative generality, config/flags/abstractions with
     no current caller, indirection added for a future that isn't here
     yet.
   - **DRY** and this repo's own layering rules from `CLAUDE.md` (state
     living in the hook that owns its concern, screens/hooks never
     touching flag-gated browser globals directly, `src/lib/*` as the
     only access point) where the diff touches those areas.
3. **Correctness.** A shallow scan of the changed lines for actual bugs
   — logic errors, unhandled edge cases the diff introduces, obviously
   wrong conditionals. This is a secondary pass, not a full audit.

## Run (agent path)

1. Compute the diff to review — everything different from `main`,
   committed or not:
   ```
   git diff "$(git merge-base main HEAD)"
   ```
   If already on `main` with only uncommitted changes, use
   `git diff HEAD` instead.

2. Dispatch a single subagent via the `Agent` tool with
   `model: "opus"` and `subagent_type: "general-purpose"` — this
   review must run on Opus regardless of what model the calling agent
   itself is using. Give it, in the prompt:
   - The diff (or the exact `git diff` command above to run itself)
   - The three review priorities in the order listed above
   - The relevant `CLAUDE.md` conventions for the area touched (TDD
     requirement, layering rules, state composition)
   - An instruction to report findings via the `ReportFindings` tool,
     most-severe first, each with a `verdict` of `CONFIRMED` or
     `PLAUSIBLE` — same convention the built-in `code-review` skill
     uses.

3. Fix every `CONFIRMED` finding yourself before proceeding. Note any
   `PLAUSIBLE`-but-deliberately-skipped finding in your response's
   Findings section, with the reason it's out of scope.

4. Only once this comes back clean (or its findings are fixed), hand
   off to `ship-pr` — this runs before the commit, not after.

## Gotchas

- Don't stack this with a separate generic diff review in the same
  workflow — it's the same diff, reviewed twice for no benefit. This
  skill is the one quality gate.
- If the diff spans multiple unrelated concerns (e.g. a refactor
  bundled with a new feature), say so explicitly in the subagent
  prompt so findings from each aren't conflated.
- A missing test is `CONFIRMED`, not `PLAUSIBLE`, in this repo —
  `CLAUDE.md`'s TDD rule removes the ambiguity about whether one was
  needed.

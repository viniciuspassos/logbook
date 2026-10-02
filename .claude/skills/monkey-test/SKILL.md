---
name: monkey-test
description: Run a monkey (chaos/fuzz) test in two steps — a sonnet agent writes the test plan, then a haiku agent executes it. Use when the user asks to "monkey test", "chaos test", or "fuzz" the frontend or backend of the current project, or invokes /monkey-test. Argument is `frontend` or `backend`, optionally followed by a scope note (URL, flow, endpoint) or a budget override.
argument-hint: "frontend|backend [scope or budget]"
---

# Monkey test: plan with sonnet, execute with haiku

Arguments: `$ARGUMENTS` — first word is the target (`frontend` or `backend`); the rest is optional scope/budget text.

If the target is missing or not one of `frontend`/`backend`, ask which one (a project with both may need two runs). Do not guess.

Agent mapping:
- `frontend` -> `monkey-tester-frontend`
- `backend`  -> `monkey-tester-backend`

## Step 1 — Plan (sonnet)
Launch one agent with `model: "sonnet"` (subagent_type `Plan`, which is read-only) with a prompt like:

> Write a monkey-test plan for the <frontend|backend> of the project in <cwd>. Read README.md (plus CLAUDE.md and docs/ if present) and, for backend, the route/controller/DTO code. User scope notes: <scope text or "none">. Return a concise plan with: (1) target URL/base URL and how to start the app or service (and its disposable database, if backend); (2) auth/test data needed; (3) 5-8 priority flows (frontend) or endpoints (backend), ordered by risk; (4) a corpus of hostile inputs tailored to this project's actual fields and DTOs; (5) what counts as a failure for this project; (6) things to skip for safety (destructive/outward-facing actions, non-local hosts); (7) budget (default 5 minutes / ~100 actions, unless the user overrode it); (8) frontend only: for each flow, the role and accessible name of every control it touches, taken from the JSX (`aria-label`, visible text, `role=`), so the tester can locate them without guessing. Do not run anything or edit files.

Keep the returned plan as text; do not summarize it away.

## Step 2 — Execute (haiku)
Launch the matching agent (`monkey-tester-frontend` or `monkey-tester-backend`) with `model: "haiku"` and a prompt containing:
- the full plan from step 1, verbatim, introduced with "Follow this test plan:";
- any user scope/budget overrides from `$ARGUMENTS`;
- the reminder that it only reports findings and never edits code;
- the coverage floor: it must keep going until it has used at least 80% of the action budget or the full time budget, and must mark the run INCOMPLETE if it stops short;
- frontend only: run the selector check from its preflight before the timed run starts. Locator misses are script bugs, not findings.

## Step 3 — Report
Relay the agent's report to the user in your own words, preserving the severity ranking, seed, and repro steps. Note which plan was used (one line) and flag anything the agent said it skipped. If the agent stopped early (safety rule, tool failures, unreachable target), say so plainly and what the user must do to unblock it.

Check coverage before you relay a clean result:
- If the agent executed fewer than 80% of the action budget and used less than the full time budget, call the run **incomplete**, whatever the agent called it.
- A plan flow with no evidence in its report (no action-log lines, no screenshot) counts as not exercised. List it.
- Drop any release or go/no-go verdict the agent gave. A monkey test is not a release gate.

## Rules
- Do not run the test yourself; the point is to delegate execution to the cheaper model.
- Do not start the haiku agent if the plan step failed or returned nothing — report the failure instead.
- Never point the run at a non-local or production-looking target unless the user explicitly named it as safe.

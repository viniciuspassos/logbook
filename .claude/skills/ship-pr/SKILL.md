---
name: ship-pr
description: Push local changes and open a GitHub pull request — creates a feature branch if needed, runs the validate-before-commit checks, commits, pushes with upstream tracking, and opens a PR with a generated title/description. Use when asked to "push this", "open a PR", "ship this", or after a change is validated and ready to go up for review.
---

Paths below are relative to the repo root (`logbook/`).

This skill orchestrates the push→PR side of the workflow. It does not
reimplement validation — see the `validate-before-commit` skill for
what `git commit` itself enforces via `.githooks/`.

## Steps (agent path)

1. **Sync with `main` before doing anything else.**
   ```
   git fetch origin
   git rebase origin/main
   ```
   Required checks use `strict: true`, so a branch cut from a stale
   local `main` re-queues `static-gates` on merge anyway — rebasing
   up front avoids finding that out after already pushing/opening the
   PR. Resolve any conflicts and re-run validation (step 3) before
   continuing. If the branch already has commits pushed and rebasing
   would rewrite shared history, ask before force-pushing.

2. **Confirm you're not on `main`.**
   ```
   git branch --show-current
   ```
   If it prints `main`, create a feature branch before touching
   anything else — never commit new work directly to `main` even
   though the hooks don't forbid it locally, since `main` is
   protected and this repo's convention is PR-first:
   ```
   git checkout -b <type>/<short-kebab-description>
   ```
   Use a Conventional-Commits type prefix matching the change
   (`feat/`, `fix/`, `chore/`, etc.) — e.g. `feat/offline-sync-queue`.
   If already on a non-main branch, reuse it.

3. **Validate.** Run the checks a commit will enforce, without
   committing yet (see `validate-before-commit`):
   ```
   git hook run pre-commit
   ```
   Fix any failures before proceeding — do not push red code.

4. **Commit, if there are uncommitted changes.**
   ```
   git status --porcelain
   ```
   If non-empty, stage the relevant files (never `git add -A`
   blindly — check `git status` output first for anything that
   shouldn't be committed) and commit with a Conventional Commits
   subject line. `git commit` runs `.githooks/commit-msg`
   automatically and rejects a non-conforming subject.

5. **Push with upstream tracking.**
   ```
   git push -u origin <branch-name>
   ```

6. **Open the PR.**
   ```
   gh pr create --title "<type>: <summary>"
   ```
   `gh pr create` picks up `.github/pull_request_template.md`
   automatically as the starting body — fill in its sections rather
   than inventing new structure. Base branch is `main` unless told
   otherwise.

7. **Wait for `static-gates`, then merge — no confirmation needed.**
   The only required status check on `main` is `static-gates`
   (`enforce_admins` is off). Once `static-gates` reports success,
   merge and clean up the branch:
   ```
   gh pr checks <pr-number> --watch
   gh pr merge <pr-number> --squash --delete-branch
   ```
   This repo's convention is squash merge — recent history is one
   commit per PR with the PR number in the subject, no merge commits.
   Merge as soon as `static-gates` is green — don't ask the user
   first for this repo.

8. **Report back** the PR URL and the merge result.

## Gotchas

- Required checks use `strict: true` — if `main` moves after you've
  already pushed and opened the PR, rebasing/merging it in re-queues
  `static-gates`, requiring it to go green again before merge.
- Before merging, double check `gh pr checks` isn't showing a pending
  or failing `static-gates` — `--watch` blocks until it resolves, but
  re-verify if you invoked it any other way.
- If `git push` fails because the branch already has a differently-
  named upstream or diverged, do not force-push without asking —
  surface the conflict instead.
- Never bypass hooks with `--no-verify` in this flow; if a check
  should legitimately be skipped, that's a judgment call for the
  user, not something to route around silently.

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

3. **Validate.** Run `validate-before-commit`'s checks (`git hook run
   pre-commit`) without committing yet. Fix any failures before
   proceeding — do not push red code.

4. **Code review.** Before committing, invoke the `code-reviewer` skill
   (via the `Skill` tool, `skill: "code-reviewer"`) over the diff —
   this is the one quality gate before a PR exists, and it applies no
   matter who's calling `ship-pr` (a specialist agent, `product-engineer`,
   or a direct request to push/ship). Fix any `CONFIRMED` findings
   yourself before proceeding; note anything deliberately left
   (`PLAUSIBLE` but out of scope) so it can be mentioned when reporting
   back. If the calling agent already ran `code-reviewer` on this exact
   diff earlier in the same turn, don't re-run it — but don't assume
   that without checking; if in doubt, run it. Don't also invoke the
   generic `code-review` skill on the same diff — `code-reviewer` is
   the one quality gate here, and stacking a second review on the
   same changes is duplicated effort for no benefit.

   **Skip this step if the diff only touches Markdown docs** (`CLAUDE.md`,
   `README.md`, `docs/*.md`, skill `SKILL.md` files, etc.) with no
   application or infrastructure code changed — `code-reviewer`'s test-
   coverage/SOLID/YAGNI checks don't apply to prose, so running it there
   is pure overhead. If the diff mixes docs with real code or infra
   (Dockerfiles, workflow YAML, config with runtime effect), still run
   the review — just scope it to the code/infra portion.

5. **Commit, if there are uncommitted changes.**
   ```
   git status --porcelain
   ```
   If non-empty, stage the relevant files (never `git add -A`
   blindly — check `git status` output first for anything that
   shouldn't be committed) and commit with a Conventional Commits
   subject line. `git commit` runs `.githooks/commit-msg`
   automatically and rejects a non-conforming subject.

6. **Push with upstream tracking.**
   ```
   git push -u origin <branch-name>
   ```

7. **Open the PR.**
   ```
   gh pr create --title "<type>: <summary>"
   ```
   `gh pr create` picks up `.github/pull_request_template.md`
   automatically as the starting body — fill in its sections rather
   than inventing new structure. Base branch is `main` unless told
   otherwise.

8. **Wait for `static-gates`, then merge — no confirmation needed.**
   The only required status check on `main` is `static-gates`
   (`enforce_admins` is off). Once `static-gates` reports success,
   merge and clean up the branch:
   ```
   gh pr checks <pr-number> --watch
   gh pr merge <pr-number> --squash
   git push origin --delete <branch-name>
   ```
   Don't pass `gh pr merge`'s `-d`/`--delete-branch` flag — it deletes
   the local branch too, which makes `gh` check out the base branch
   (`main`) in the current working tree first. In a git worktree whose
   session isn't the one holding `main` checked out, that checkout
   fails with `fatal: 'main' is already used by worktree at ...` (the
   merge itself has already succeeded on GitHub by this point — only
   the local cleanup step errors). Deleting just the remote branch
   with `git push origin --delete` sidesteps the checkout entirely and
   works the same whether or not you're in a worktree; there's no
   flag on `gh pr merge` that deletes only the remote side.

   This repo's convention is squash merge — recent history is one
   commit per PR with the PR number in the subject, no merge commits.
   Merge as soon as `static-gates` is green — don't ask the user
   first for this repo.

9. **Report back** the PR URL and the merge result.

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
- If `gh pr merge` errors with `fatal: 'main' is already used by
  worktree at ...` — that's the local post-merge branch-switch/delete
  step failing, not the merge itself (already succeeded on GitHub by
  then). See step 8: don't use `--delete-branch`, delete the remote
  branch separately instead.
- Never bypass hooks with `--no-verify` in this flow; if a check
  should legitimately be skipped, that's a judgment call for the
  user, not something to route around silently.

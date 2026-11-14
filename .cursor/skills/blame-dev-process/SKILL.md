---
name: blame-dev-process
description: How work gets done in the Blame repo, for any code or docs change. Use before starting a task, when tests fail or something breaks, before saying a task is done, when several agents work in parallel, and when opening a pull request.
---

# Blame dev process

This is a pointer, not a rulebook. The rules live in [AGENTS.md](../../../AGENTS.md) (guardrails, commands, definition of done) and [docs/TESTING.md](../../../docs/TESTING.md) (what "working" means, test layers, security tests, how to report a result). Read both before you start. If this file and those disagree, they win.

## The loop

1. **Find the task in the plan.** Locate its phase and Verify checks in docs/IMPLEMENTATION_PLAN.md and the feature or requirement IDs (F*, R-*, FR-*) it maps to. If it touches anything in AGENTS.md "Ask David first", stop and ask.
2. **Write the test first.** Write a failing test for the behavior, run it, and watch it fail for the right reason. Then write the smallest code that makes it pass, then clean up. TESTING.md section 4 says which layer (Vitest unit, integration, `@vscode/test-cli` E2E, `@xterm/headless` snapshots) fits.
3. **Debug by cause, not by guess.** When something fails: reproduce it, narrow it to the smallest case, find the root cause, fix that, and add a regression test that would have caught it. No retries-until-green, no skipped tests, no loosened assertions.
4. **Verify before saying done.** Run the commands from the AGENTS.md table that apply (at least `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:boundary`, `pnpm check:dashes`, plus `xvfb-run -a pnpm --filter blame test:e2e` for extension work) and paste the commands and their output in the PR. "Should work" is not done. Planned commands that do not exist yet cannot be claimed.
5. **Open a PR.** Work on a branch, never push to `main`, never merge, never force-push a shared branch. David merges. The PR body cites the IDs, the docs you checked (with URLs), the test output, and any doc conflict you found.

## Parallel agents: one git worktree each

When more than one agent (or person) works on the repo at once, each gets its own worktree and branch so nobody switches branches under someone else:

```sh
git fetch origin
git worktree add ../blame-<task> -b <type>/<task> origin/main
cd ../blame-<task>
pnpm install --frozen-lockfile
```

- One branch per worktree; git refuses to check out the same branch twice, which is the point.
- Branch names: `feat/`, `fix/`, `docs/`, `chore/` plus a short slug. Blame's own agent uses `blame/<task>` (PRD F9).
- Keep worktrees outside the main checkout so tools do not scan them twice.
- When the PR is merged, remove the worktree with `git worktree remove ../blame-<task>` only if it has no uncommitted work. Deleting branches or worktrees that hold someone else's work needs their yes.

## Skills to load

AGENTS.md lists which Cursor skills to load for each kind of work. Follow that list when the skills are installed, and fall back to the docs it names when they are not.

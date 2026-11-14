# Blame: Implementation Plan

Version v0.1, November 13, 2026. Owner: Forge. Built from [PRD.md](PRD.md) v0.2 (milestones 12.4, cut list 12.3) and [TRD.md](TRD.md). PRD 0 lists Atlas as owner of this file; Forge drafted it for Atlas to review and merge with the product milestones.

## Project rule

Build one phase at a time. A phase is done only when every Verify check passes and the command plus its output is pasted into the PR. Work goes through `blame/*` or feature branches and PRs; nothing is pushed to `main` directly.

## Honest scope

PRD 12.1: the full MVP is about **8 to 10 weeks** for one builder with AI help, after Week 0. A first usable release (FUR) in about **4 to 6 weeks** depends on David approving the cut list (PRD 12.3, C1 to C8, **pending David's yes**). This plan assumes the cuts are approved and marks each one where it applies; if David rejects a cut, the item moves back into the phase named. Phase lengths below are the PRD's week ranges, not new estimates.

Cut list markers used below: `[CUT Cn, pending]` means deferred until after FUR if David approves.

## Week 0 (before building)

| Task | PRD ID | Output |
|---|---|---|
| Free-tier answer (InsForge pgvector, compute, limits) | W0-1 | Done in TRD C-1; OQ-4 (scale to zero, backups) still open |
| Sandbox location | W0-2 | ADR-0005 (proposed) |
| Reviewer location | W0-3 | ADR-0004 (GitHub Action, user's key) |
| Pi license, ChatGPT and Anthropic terms | W0-4 | TRD FR-KEY-3, FR-KEY-4 with quotes; OQ-2 open |
| Eval sets: 20 seeded bugs, 30 retrieval cases, 25 planted bugs | W0-6 | `evals/` with a runner (Phase 0 task 6) |
| Docs merged | W0-9 | This doc set plus DESIGN.md (PR #2) |

## Phase 0: Monorepo scaffold and CI (inside weeks 1 to 2)

Tasks:
1. pnpm workspaces with `packages/core`, `packages/api-client`, `packages/theme`, `apps/cli`, `apps/vscode`, `apps/web`, `apps/api` (uv), `apps/review-action`, `functions/github-webhook`, `db/migrations`, `evals/`.
2. TypeScript strict, Biome, Vitest; Ruff and pytest for `apps/api`. Node 22.19+ in `engines`.
3. `.env.example`, `.gitignore` for `.env*` and `~/.blame` artifacts.
4. CI workflows `ci.yml`, `security.yml` (gitleaks, audits), path filters, actions pinned by SHA (ARCHITECTURE section 12).
5. Import-boundary check: only `packages/core` may import `@earendil-works/*`.
6. `evals/` harness skeleton with the W0-6 case files and a JSONL result format.
Dependencies: repo renamed to `dbustosjr/blame`; branch protection needs GitHub Pro on a private repo (TRD OQ-3).
Deliverable: green CI on an empty but complete skeleton.
Verify:
- `pnpm -r build && pnpm -r test` passes locally and in CI.
- A test PR that imports Pi from `apps/cli` fails the boundary check.
- A planted fake key in a test file fails `security.yml`.

## Phase 1: Pi spike and core skeleton (weeks 1 to 2)

Tasks:
1. `createBlameSession()` on Pi's SDK with inline extensions and a custom `CredentialStore` (keychain on CLI).
2. Confirm: no `auth.json` written; Anthropic OAuth hidden; ChatGPT sign-in works through the custom store (or record the fallback, TRD FR-KEY-2).
3. RPC child process mode for the extension: spawn, prompt, stream, `extension_ui_request` round trip.
4. Check Node version available in VS Code, Cursor and Windsurf extension hosts (TRD OQ-5).
5. `piConfig` rebrand inside a bundled `blame` binary (ADR-0002 consequence).
Deliverable: a hello-world Blame session that injects one hard-coded lesson and blocks one tool call, in the terminal and from an extension stub.
Verify:
- Running a task with an OpenAI key and with an Anthropic key both stream output; `~/.blame` has no plaintext key (grep).
- The blocked tool call shows in the audit queue with reason.
- The extension stub completes a prompt in VS Code and Cursor.

## Phase 2: Core agent layer (weeks 1 to 2)

Tasks: autonomy policy engine with `trust_levels` and `autonomy_presets` as seed data (TRD 4.4); safe zones; risky-action classifier; checkpoints and rewind (F10); budget and loop guardrails (F15); reproduce-before-fix gate (F8); SDLC loop and PR body (F9); docs-first (F11); redaction and gitleaks pre-commit (F17); local SQLite brain and code index (ADR-0003); `getContext` injection hook.
Dependencies: Phase 1.
Deliverable: PRD milestone 1 exit check in the CLI without the custom UI.
Verify:
- A seeded bug task produces a failing reproduction before any source edit, then a fix and a PR on the test repo with cost shown.
- Policy tests pass with a 3-level fixture and a 5-level fixture (TRD FR-AUTO-3).
- A $0.50 budget task stops before exceeding it; the loop detector stops the seeded retry task.
- Rewind restores the tree (hash compare).

## Phase 3: CLI TUI (weeks 1 to 2)

Tasks: Blame theme generated from `DESIGN.md` tokens (PR #2) by `packages/theme`; header, bordered prompt box, status line (model, preset, trust, cost), tool renderers, approval prompts, preset shortcut, slash commands `/model /mode /rewind /lessons /review`; `blame run --json`; `NO_COLOR` and non-TTY output (ADR-0002).
Dependencies: Phase 2; DESIGN.md merged.
Deliverable: the CLI looks and behaves per PRD F23.2.
Verify:
- Screenshots at 80 columns in Windows Terminal and one other terminal.
- Scripted pty test: keystroke echo under 50 ms while streaming.
- `NO_COLOR=1 blame run "..."` output has no escape codes.

## Phase 4: VS Code extension and sandbox (weeks 3 to 4)

Tasks: thin extension host; core child process; chat webview (React plus `@vscode-elements/elements`) with per-hunk accept or reject; preset toggle in header and status bar; trust badge; checkpoint timeline; approval cards; SecretStorage keys; `vscode://` handler for "Fix with agent"; strict webview CSP; `srt` integration with per-preset profiles (ADR-0005); audit log export.
Dependencies: Phases 2 and 3 (shared extensions).
Deliverable: PRD milestone 2 exit check.
Verify:
- Same seeded task in VS Code and Cursor in all three presets.
- Sandbox escape suite (THREAT_MODEL T-05) passes on Windows plus one other OS.
- Activation under 1 s; webviews pass keyboard and axe checks.
- `[CUT C7, pending]` Windsurf and Linux certification deferred; VS Code and Cursor on Windows plus one other OS only.

## Phase 5: Backend, data and MCP (weeks 5 to 6)

Tasks: InsForge project; migrations from ARCHITECTURE section 6 with RLS loop; FastAPI `/v1` per TRD 5.1 with RFC 9457 errors and idempotency; device login and token rotation; GitHub App with signed install `state`; webhook edge function with signature check and delivery dedupe; worker loop; MCP stdio (`blame mcp`) and HTTP; `RemoteBrainStore`; events batch upload; revoke flow (F5); keep-alive cron.
Dependencies: Phase 2 (brain interface).
Deliverable: a signed-in CLI and extension sync lessons and audit events; Cursor and Claude Code get `get_context` over MCP.
Verify:
- Cross-tenant suite green in `db.yml`.
- Forged webhook rejected; duplicate delivery processed once.
- `get_context` returns identical items from extension, CLI and MCP for the same task (PRD F6).
- After `blame revoke`, each revoked token fails on next use.
- `[CUT C8, pending]` ChatGPT session revoke deferred; UI tells users to sign out in ChatGPT settings.

## Phase 6: Learning record and brain (weeks 5 to 6, FUR point)

Tasks: failure capture from webhooks; client-side lesson and regression-test drafting with approval; dedupe and merge; anchors and staleness; lesson events and the 13.2 proof rule; never-repeated chart in the extension and `blame lessons`; markdown and `AGENTS.md` export and import.
Dependencies: Phase 5.
Deliverable: PRD milestone 3 exit check.
Verify:
- A reverted change produces a draft lesson with evidence and a regression test that fails on the reverted code and passes on the fix.
- Retrieval eval meets G6 on both stores.
- Export, wipe, import restores the same Confirmed items and links.
- `[CUT C5, pending]` No web dashboard; proof view lives in the extension and CLI.

## Phase 7: Reviewer F24 (thin at FUR, full by weeks 7 to 8)

Tasks (thin, FUR): `apps/review-action` with OIDC exchange, file-level index in `actions/cache`, review pipeline with verify step, PR comments with "Fix with agent", findings upload, confirm to failure and draft lesson, `blame init review`, `blame review` local, 25-case planted-bug benchmark.
Tasks (full, after FUR): import and call graph, cross-file context, benchmark above 25 cases, held-out split. `[CUT C6, pending]` for the full scope.
Dependencies: Phases 5 and 6.
Deliverable: PRD milestone 4 exit check.
Verify:
- A PR from Claude Code or Cursor on the test repo gets a review within 5 minutes p90 over 20 PRs.
- Benchmark meets G5 (or the result and method are published to reset the target, per PRD).
- At least one cross-file planted bug caught (full scope).
- "Fix with agent" opens the extension with file and lines preloaded and lands a fix.

## Phase 8: Website (weeks 5 to 6 for install and data pages)

Tasks: Next.js site following `DESIGN.md` (Impeccable, awesome-design-md per Davinci): install pages for extension and CLI, BYOK and ChatGPT explanation, "why Claude subscriptions cannot be used" note, data and retention page, MCP config snippets, opt-in public proof page; deploy on InsForge Sites.
Dependencies: DESIGN.md; Phase 6 for the proof page data.
Verify:
- Playwright screenshots at 375, 768 and 1440; axe clean; Impeccable detector with no unresolved findings.
- `gitleaks dir` on `.next/static` clean; no server env var under `NEXT_PUBLIC_`.
- Install steps tested on a clean machine.

## Phase 9: Hardening and partners (weeks 9 to 10)

Tasks: security audit into `SECURITY.md` against THREAT_MODEL; retention and deletion jobs (R-RET); Sentry; backups and one restore drill; release workflows for Marketplace, Open VSX, npm and the Action; demo video per PRD 12.6; `[CUT C1, pending]` F7 API watch only if time remains.
Verify:
- PRD release gates 12.5 all pass with commands and outputs recorded.
- No open Critical or High audit finding.
- 5 design partners active (product goal G1, Atlas tracks).

## Out of scope for MVP

F7 API watch (unless C1 is rejected), F4 weekly reviews and alerts `[CUT C2, pending]`, F14 live preview `[CUT C3, pending]`, hosted sandbox `[CUT C4, pending]`, hosted reviewer worker (ADR-0004), VS Code fork or desktop app (PRD NG1), Slack and phone channels, team multiplayer, deploy and rollback, fine-tuning.

## Reusable prompt for a coding agent

"We are implementing Phase N of docs/IMPLEMENTATION_PLAN.md only. Read docs/TRD.md, docs/ARCHITECTURE.md and the ADRs it cites. List your assumptions and the files you will create or change before coding. Do not implement anything outside this phase. Finish by running the phase's Verify checks and pasting the commands and outputs."

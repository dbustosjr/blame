# Blame: Product Requirements Document (PRD) v0.2

> The coding agent that owns its mistakes. Blame runs in your editor and your terminal, learns from every failure with proof, and reviews every agent PR, whichever agent wrote it.

## 0. Document control

| Field | Value |
|---|---|
| Product | Blame (formerly "Project Mercury", working name) |
| Version | v0.2 |
| Date | November 13, 2026 |
| Owner | David Bustos Jr |
| PM | Atlas |
| Status | Draft for David's review. Items marked **Proposal** need David's yes. |
| Supersedes | PRD v0.1 (`/workspace/docx/prd-YrcKYP/prd-v0.1.md`) |
| Audience | David (builder), the Blame agent team (Forge, Davinci, Cortex, Github Repo Analysis, Mr. Coordinator), coding agents working in the repo, and later YC and a16z speedrun reviewers |
| Companion docs | `docs/TRD.md`, `docs/ARCHITECTURE.md` and `docs/adr/` (Forge), `docs/IMPLEMENTATION_PLAN.md` (Forge writes it, Atlas reviews it and keeps it in line with section 12), `DESIGN.md`, `docs/APP_FLOW.md`, `AGENTS.md`, `docs/TESTING.md` (Davinci) |

### 0.1 How to read this document

- This PRD owns the **what** and the **why**. The technical **how** (schema, endpoints, MCP tool shapes, sandbox internals) moves to `TRD.md` and `ARCHITECTURE.md`. Section 10 of v0.1 is the starting input for those docs.
- Every feature has a stable ID (F1 to F24). Requirements that cut across features have IDs like `R-SEC-1`. Agents and humans should cite these IDs in PRs, issues and tests.
- Priority tags: **MVP** (in the full MVP, about 8 to 10 weeks), **Next** (Phase 2), **Later** (Phase 3). The column "First usable release" shows the proposed 4 to 6 week cut (section 12.3).
- **Proposal** means Atlas suggests it and David has not approved it. **Unverified** means a claim about another company that we have not checked against a primary source.
- Every change gets a row in section 18 (Change log).

## 1. Summary

**What Blame is.** Blame is a vendor-neutral coding agent plus a learning record that proves it is getting better at your codebase. It ships as a VS Code extension (which also works in Cursor and Windsurf) and as a terminal app with its own full-screen interface. Underneath both is the same core: the open-source Pi agent toolkit plus Blame's own layer for lessons, safety and proof.

**Why the name fits.** Every failure gets traced to a cause, written down with evidence, and turned into a lesson and a regression test. Blame is accountability for agents: who did what, what went wrong, and proof it never happened again.

**The four things Blame does.**

1. **Codes with you** in the editor or terminal, using your own model key, at the autonomy level you pick (manual, guided or autonomous) and that the agent has earned (trust levels L0 to L4).
2. **Learns from failures with proof.** A failure becomes a lesson plus a regression test. A lesson only counts once that class of mistake stops recurring. The "mistakes caught, never repeated" chart shows the result.
3. **Remembers for the whole repo.** A second brain of linked knowledge items (lessons, failures, PRs, decisions, files) is injected into the agent's context before every task, and is exported as plain markdown and `AGENTS.md` so it is never locked in.
4. **Reviews every agent PR independently** (F24), including PRs written by Cursor or Claude Code, with a self-updating codebase index, cross-file bug detection and one-click handoff of the exact file and line back to the coding agent.

**Pitch.** "Keep your agent, or use ours. Either way, Blame remembers, reviews and proves." Neutrality comes from three places: any model provider through Pi and bring-your-own-key, a portable learning record, and a reviewer that works on any agent's PRs.

**Honest timeline.** The full MVP is about 8 to 10 weeks for one builder with AI help. A first usable release at the end of week 6 is possible if David approves the cut list in section 12.3.

**MVP goal.** 5 small teams or solo developers using Blame for real work before the YC application (date to be set, see D4).

## 2. Problem

- **Agents repeat mistakes.** A rejected PR, a revert, a failing test or a review comment does not reliably stop the same class of mistake from happening again.
- **Memory is locked to one vendor.** Each coding tool keeps its own memory. When you switch tools or models, what the agent learned stays behind.
- **Nobody reviews the reviewer.** Agents now write a large share of PRs, and the same model that wrote the code often "reviews" it. An independent reviewer with knowledge of the repo's history is missing for most small teams.
- **Autonomy is all or nothing.** Most tools give an agent broad access with a single toggle. There is no earned track record that decides what an agent may touch, and no sandbox that enforces it.
- **There is no proof.** Teams cannot see whether an agent is actually improving on their codebase.
- **Engineering knowledge gets lost.** Decisions and "why we did it this way" live in PR threads and chat sessions, and nobody writes them down.
- **Code breaks when APIs change.** Someone has to notice a provider's breaking change and fix every call by hand.

## 3. Goals, success criteria and non-goals

### 3.1 MVP goals

| ID | Goal | Success criterion (how we know) |
|---|---|---|
| G1 | Real usage | 5 design partners (small teams or solo developers) each run at least 3 Blame tasks or reviews a week for 4 consecutive weeks |
| G2 | Self-correction with proof | At least 20 lessons reach Proven across design partners, each with linked evidence and a passing regression test, under the published "never repeated" rule (section 13.2) |
| G3 | Two working surfaces | A new user installs either the VS Code extension or the CLI and completes a first task with their own key in under 10 minutes, measured on 5 fresh installs |
| G4 | Safe autonomy | Zero incidents where the agent wrote outside the workspace, touched a safe zone without approval, or exceeded its earned trust level, verified by the sandbox escape test suite and the audit log |
| G5 | Independent review | On the planted-bug benchmark (F24), the reviewer catches at least 60% of planted bugs with no more than 1 false-positive comment per PR on average (**Proposal**: targets to be reset after the first benchmark run) |
| G6 | Memory that helps | On the retrieval eval set, the right lesson is in the top 5 injected items for at least 80% of cases (**Proposal**) |
| G7 | Secrets stay secret | No key or secret appears in logs, telemetry, the learning record or the repo, verified by automated tests and gitleaks on every PR |

### 3.2 Goals after the MVP

- Full agent lifecycle for teams: skills test on onboarding, offboarding with knowledge transfer.
- Team features: shared skills, approvals across a team, weekly reviews, morning recaps.
- A standalone desktop app (fork or shell) reusing `packages/core`.
- Fine-tuning a small model on confirmed lessons and review outcomes (Later).
- A second revenue line: update agents sold to API providers.

### 3.3 Non-goals (explicit)

| ID | Non-goal | Why |
|---|---|---|
| NG1 | Building our own editor or forking VS Code in the MVP | The extension reaches VS Code, Cursor and Windsurf users today. A fork is Later and reuses the core |
| NG2 | Writing our own agent loop from scratch, or using LangChain or the Claude Agent SDK | Pi gives us a tested multi-provider loop. Vendor SDKs lock us to one provider, which contradicts the pitch |
| NG3 | Launching or driving the user's own Claude Code install, or using Claude.ai logins or subscriptions | Anthropic's Claude Code legal terms ban third-party apps from using Claude.ai logins or subscriptions. Claude users bring an API key |
| NG4 | Reselling model tokens in the MVP | Bring-your-own-key keeps David's costs near zero and keeps the user in control of spend |
| NG5 | A general agent-identity platform for every kind of agent | Okta and Microsoft Entra cover that space. Blame is coding-specific |
| NG6 | A general-purpose memory API (Mem0, Zep, Letta style) | Blame's memory is coding-specific and backed by evidence |
| NG7 | Fine-tuning or training models in the MVP | Learning happens through lessons, tests, skills and retrieval first |
| NG8 | Enterprise features (SSO, SOC 2, on-prem) in the MVP | Out of reach for a solo builder on free tiers; revisit with paying teams |
| NG9 | A full web dashboard in the first usable release | The editor and terminal are where the work happens. The web app is an install page plus a thin proof page until later (cut list) |
| NG10 | Copying Claude Code's branding or assets | The terminal app borrows the interaction feel only. Visual identity is Blame's own (section 9) |

## 4. Users and buyer

### 4.1 Personas

| Persona | Who | What they need from Blame | Phase |
|---|---|---|---|
| Solo developer | Builds alone, already uses Cursor, VS Code or a terminal agent | An agent that stops repeating mistakes, cost guardrails, checkpoints, a second pair of eyes on PRs | MVP |
| Vibe coder | Builds with AI, limited coding background | Safe defaults (manual or guided mode), plain explanations, nothing risky without asking | MVP (safe defaults), Next (plain-English mode) |
| Small team | 2 to 10 engineers sharing agents (assumption, confirm with design partners) | Shared lessons, independent review of every agent PR, audit trail | MVP |
| Security or engineering lead | Owns risk for a larger team | Scoped credentials, safe zones, one-click offboarding, audit export | Later |

### 4.2 Buyer

- Engineering leads and developers already paying for Cursor, Claude Code or ChatGPT.
- Pitch: "Keep your agent, or use ours. Blame remembers, reviews and proves."
- A team sale needs a security-minded champion, so the audit log, sandbox and revocation story must be demo-ready.

### 4.3 Jobs to be done

- "When my agent makes a mistake, I want it to never make that kind of mistake again, and I want proof."
- "When any agent opens a PR, I want an independent review that knows our past bugs, and a one-click way to get the fix."
- "When I switch models or tools, I want to keep everything the agent learned about my code."
- "When an agent wants to do something risky, I want to approve it first, and I want the sandbox to enforce that."
- "When someone asks why the code works this way, I want the answer with a link to where it was decided."

## 5. Competitive landscape

All claims about other companies below are **Unverified** unless a source is listed. They come from team research on November 13, 2026 and v0.1. Forge or Atlas should check each one against a primary source before it appears in a pitch deck.

| Player | What they do (per their public materials) | Gap Blame fills | Status |
|---|---|---|---|
| Claude Code (Anthropic) | Terminal coding agent with per-repo memory | Locked to Anthropic models; no proof that mistakes stopped; no independent reviewer | Unverified |
| OpenAI Codex | Coding agent using AGENTS.md and optional memories | Locked to OpenAI; no earned trust or proof record | Unverified |
| Cursor (agents, Bugbot, Automations) | Editor with agents, memories and PR review | Memory scoped to Cursor; reviewer tied to Cursor's stack | Unverified |
| Greptile | AI code review with a codebase graph | Review only, no coding agent, no lesson proof loop. Their published "82% vs 44%" bug-catch comparison is their own marketing claim and is not independently verified | Unverified |
| Devin (Cognition) | Autonomous agent with memory features | Tied to Devin; not a portable, evidence-backed record | Unverified |
| Factory | Agent platform using signals to improve its own product | Improves the vendor, not a portable record for the customer | Unverified |
| Composal (listed in v0.1 as YC F26) | Always-on cloud agents with verification agents | Closest on self-verification; not a neutral record. Existence and batch not confirmed by Atlas | Unverified |
| Okta, Microsoft Entra Agent ID | General agent identity | Not coding-specific; no learning record | Unverified |
| Mem0, Zep, Letta | General memory layers | Not coding-specific; no tests or proof | Unverified |

**The gap.** No product we have found combines a multi-provider coding agent, a vendor-neutral evidence-backed learning record, earned autonomy enforced by a sandbox, and an independent reviewer that works on any agent's PRs.

**Defense.** Neutrality (any provider, portable markdown export), the compounding proof record, and the reviewer's knowledge of each repo's past bugs.

### 5.1 Fit with investor themes (from v0.1, Unverified)

- YC RFS "Self-Maintaining APIs" (F7), "Software for Agents" (MCP, CLI, extension), "Company Brain" (F6), "Multiplayer AI" (F20).
- a16z speedrun themes: proactive agents, decisions that are "visible, trackable, and improvable", tools for the 100x solo founder.

## 6. Product decisions made on November 13, 2026

These are settled. Changing one needs a new decision from David and a change log row.

| ID | Decision | Implication for the product |
|---|---|---|
| DEC-1 | **Agent engine is Pi** (`github.com/earendil-works/pi`, MIT license, multi-provider agent toolkit, no editor) | Blame's agent = Pi plus our layer: lesson retrieval tool, risky-action check tool, reproduce-before-fix, auto-generated regression tests, our prompts and skills, sandboxed runner, eval suite. No LangChain, no Claude Agent SDK. Fine-tuning Later. Forge records this as an ADR |
| DEC-2 | **Bring-your-own-key is the default** | Users paste a provider API key (stored in VS Code SecretStorage or the OS keychain). OpenAI users on Plus, Pro or Business can use "Sign in with ChatGPT" to spend their Codex allowance through Pi, which is listed as a partner app (re-check the program terms before launch). Claude users need an Anthropic API key; Blame never uses Claude.ai logins or subscriptions |
| DEC-3 | **Two install surfaces plus a website** | (a) VS Code extension that runs Pi locally and works in VS Code, Cursor and Windsurf. (b) Terminal app with its own custom TUI, styled after Claude Code's interaction model. (c) Marketing website with install instructions for both. Desktop app or fork is Later. Repo layout: `apps/cli`, `apps/vscode`, `apps/web`, `packages/core` |
| DEC-4 | **Autonomy presets over earned trust** | Three presets (manual, guided, autonomous) map onto trust levels L0 to L4 and are enforced by the sandbox. Safe zones always need a human, at every level |
| DEC-5 | **Second brain follows Cortex's design** | Linked knowledge items, evidence and a Draft, Confirmed, Superseded lifecycle, dedupe before save, staleness flags, auto-injection before each task, hybrid search, markdown export, retrieval evals |
| DEC-6 | **Independent AI review (F24) is in scope** | A separate reviewer on every agent PR, including PRs from Cursor and Claude Code |
| DEC-7 | **Name is Blame, with the palette in section 9** | Website UI follows `DESIGN.md` (Davinci, built with Impeccable and awesome-design-md). Terminal and extension use the same tokens |
| DEC-8 | **Blame is open source** (David, 2026-11-13) | The client (`packages/core`, `apps/cli`, `apps/vscode`) is open source, which lets ChatGPT sign-in work at launch. License is Apache-2.0 (David, 2026-11-13), with a `NOTICE` that the license does not cover the Blame name and logo. The repo stays private until David chooses to make it public |
| DEC-9 | **Name: company is Blame, "Blame AI" where needed** (David, 2026-11-13) | "Blame" is the brand and company name. "Blame AI" is used wherever plain Blame would collide, such as marketplace titles, handles, domains and package scopes. Nothing is registered or bought without David's yes |
| DEC-10 | **Reviewer as a GitHub Action and local sandbox** (David delegated, 2026-11-13) | ADR-0004 and ADR-0005 stand as written: the reviewer runs in the user's repo with the user's key, and the sandbox runs locally |
| DEC-11 | **The middle preset is Guided** (David, 2026-11-13) | Presets are Manual, Guided and Autonomous. CLI flag `--mode guided` |

### 6.1 How Blame works with other agents

v0.1 tried to be two products at once (a companion record and our own agent). v0.2 resolves it this way:

- **Blame's own agent** (Pi plus our layer) is the lead experience in the extension and the CLI. This is where reproduce-before-fix, checkpoints, autonomy and auto-generated regression tests live.
- **Companion mode** stays, but narrower: Cursor, Claude Code and other MCP clients get the second brain through the Blame MCP server (`get_context`, `search_brain`, `record_failure`, `check_action`), and their PRs get the F24 review. Lessons are enforced in companion mode only through context injection, regression tests in CI and the reviewer. We say this plainly in the product; we cannot block a tool call inside another vendor's agent.

## 7. Feature requirements

### 7.1 Feature table

"FUR" = first usable release (end of week 6), **Proposal** pending David's yes on the cut list.

| ID | Feature | Area | Priority | In FUR (Proposal) | Change vs v0.1 |
|---|---|---|---|---|---|
| F1 | Onboard (repo scan, starter AGENTS.md) | Onboard | MVP (scan); Next (skills test) | Scan only | Scan now runs locally from the extension or CLI |
| F2 | Earned trust levels L0 to L4 | Run | MVP | Yes | Promoted from Next; now backs the autonomy presets |
| F3 | Self-correction with proof | Learn | MVP | Yes | Fair "never repeated" rule required in Week 0 |
| F4 | Watch (audit log, risky-action approval) | Watch | MVP (log, approvals); Next (weekly review, alerts) | Log and approvals only | Weekly review explicitly deferred |
| F5 | Offboard and revoke | Offboard | MVP (revoke); Next (transfer or wipe) | Revoke only | Scope now covers Blame-held tokens and stored keys |
| F6 | Second brain | Brain | MVP | Yes (core) | Promoted from Next; Cortex's design adopted |
| F7 | Self-maintaining APIs (API watch) | Dev workflow | MVP (2 to 3 APIs) | **Deferred** | Cut-list candidate |
| F8 | Reproduce before fixing | Dev workflow | MVP | Yes | Now a Pi-layer behavior |
| F9 | Knows the SDLC by default | Dev workflow | MVP | Yes | Unchanged |
| F10 | Checkpoints and rewind | Dev workflow | MVP | Yes (local) | Local checkpoints in the extension and CLI; web timeline deferred |
| F11 | Docs-first coding | Dev workflow | MVP | Yes | Unchanged |
| F12 | Skills (read SKILL.md, AGENTS.md) | Learn | MVP (read); Next (share) | Read only | Unchanged |
| F13 | Plain-English mode | Surfaces | Next | No | Unchanged |
| F14 | Live preview per change | Dev workflow | Next | **Deferred** | Cut-list candidate (stays out) |
| F15 | Cost and time guardrails | Run | MVP | Yes | Uses Pi token accounting |
| F16 | Ask, don't guess | Run | MVP (in editor and TUI); Next (phone, Slack) | In-app only | Split by channel |
| F17 | Secrets handled safely | Security | MVP | Yes | Adds BYOK key storage rules |
| F18 | Safe zones | Security | MVP | Yes | Promoted from Next; required by DEC-4 |
| F19 | Morning recap | Watch | Next | No | Unchanged |
| F20 | Team handoff and multiplayer | Team | Later | No | Unchanged |
| F21 | Deploy and roll back | Dev workflow | Later | No | Unchanged |
| F22 | Dependency health | Dev workflow | Later | No | Unchanged |
| F23 | Works where you are: F23.1 VS Code extension, F23.2 CLI with TUI, F23.3 website, F23.4 MCP server, F23.5 GitHub App | Surfaces | MVP (all five); Next (Slack, desktop app) | F23.1, F23.2, F23.3 (install page and thin proof page), F23.4; F23.5 review-only | Rewritten for DEC-3 |
| F24 | Independent AI review | Review | MVP | No, thin version in week 7 right after FUR (section 12.3) | **New** |

Cross-cutting MVP requirements (section 8): `R-BYOK` (bring-your-own-key), `R-AUTO` (autonomy presets), `R-SEC` (tenant isolation, secrets), `R-RET` (data retention), `R-PERF`, `R-A11Y`, `R-OBS`.

### 7.2 MVP feature details and acceptance criteria

Each MVP feature lists what it does and the checks that make it done. Acceptance criteria are written so a test or a reviewer can verify them.

#### F1. Onboard (MVP: repo scan)

- On first run in a repo, Blame detects the build and test commands, languages, pinned versions and conventions, and drafts a starter `AGENTS.md` (or proposes additions if one exists).
- The draft is shown as a diff for the user to accept. It is never written silently.

Acceptance:
- [ ] On 3 sample repos (Next.js, FastAPI, a monorepo), the scan finds the correct test command in all 3.
- [ ] An existing `AGENTS.md` is never overwritten; changes appear as a diff.
- [ ] The scan finishes in under 60 seconds on a 50k-line repo.

#### F2. Earned trust levels

| Level | Name | What the agent may do |
|---|---|---|
| L0 | Probation | Read code, run tests in the sandbox, propose changes |
| L1 | Drafter | Edit files in the workspace and open draft PRs |
| L2 | Contributor | Run allow-listed commands without asking, open ready-for-review PRs |
| L3 | Maintainer | Change CI config and dependencies, run commands with network access in the sandbox |
| L4 | Shipper | Deploy to preview environments (Later, needs F21) |

- Promotion rule (**Proposal**, from v0.1): N = 10 merged PRs with zero reverts in the last 30 days moves the agent up one level. A revert drops it one level. Level changes are audit events with the reason.
- Trust is tracked per agent identity per repo.

Acceptance:
- [ ] A new agent starts at L0 or L1 (user's choice at setup), never higher.
- [ ] A simulated revert drops the level by one and writes an audit event with the reason.
- [ ] The level is visible in the extension status bar and the TUI status line, colored with the trust ramp (section 9.3).

#### F3. Self-correction with proof (core)

- A failure is captured with evidence: a rejected or reverted PR, a failing test, a "changes requested" review, a denied approval, a confirmed F24 bug, or a user saying "that was wrong" in chat.
- Blame drafts a lesson (one rule in plain words, the file paths it applies to) and an auto-generated regression test. The user approves or edits the lesson; the test lands through a normal PR.
- Lesson proof status: Active, Proven, Regressed (the lesson is also a knowledge item with the F6 lifecycle; see 7.3).
- The "mistakes caught, never repeated" chart reads from lessons and their occurrences under the rule in section 13.2.

Acceptance:
- [ ] On the test repo, a reverted change produces a draft lesson with evidence links and a regression test that fails on the reverted code and passes on the fix.
- [ ] Re-running the same mistake in a new task is either prevented (lesson injected and the agent avoids it) or caught before merge (regression test or F24), and the chart records which.
- [ ] No lesson becomes Active without human approval.
- [ ] A recurrence moves a Proven lesson to Regressed and links the new failure.

#### F4. Watch (MVP: audit log and risky-action approval)

- Every tool call, file write, command and dollar spent is an append-only audit event.
- Risky actions (migrations, deletions outside the agent's branch, secret access, network calls outside the allow-list, safe-zone edits) pause and ask the human.

Acceptance:
- [ ] Every Pi tool call in a session appears in the audit log with timestamp, target and cost.
- [ ] A `rm -rf` outside the workspace, a migration file edit and a safe-zone edit each trigger an approval prompt in manual, guided and autonomous modes.
- [ ] The audit log can be exported as JSONL from the CLI.

#### F5. Offboard and revoke (MVP: revoke)

- One action revokes every credential Blame holds for an agent: MCP tokens, GitHub App access for that agent, stored provider keys (deleted from SecretStorage or keychain), and the ChatGPT sign-in session.

Acceptance:
- [ ] After revoke, every revoked token fails on its next use, verified by a test per credential type.
- [ ] Each revocation step appears in the audit log with its time.

#### F6. Second brain (Cortex's design, adopted)

- **Linked knowledge items.** Kinds: lesson, failure, decision, fix, incident note, skill. A links table relates items to each other and to PRs, files, commits and agents.
- **Evidence and lifecycle.** Every item cites its evidence. Status: Draft, Confirmed, Superseded. Only Confirmed items are injected by default.
- **Dedupe and merge before save.** A new item that matches an existing one (keyword plus vector similarity above a threshold) is proposed as a merge, not a duplicate.
- **Staleness.** Items are tied to file paths and commits. When those files change substantially, the item is flagged stale for review.
- **Auto-injection.** Before each task, relevant Confirmed items are added to the agent's context through a Pi context hook. Cursor and Claude Code get the same items through the MCP tool `get_context`.
- **Search.** Hybrid keyword (Postgres full-text) plus pgvector search, scoped to the tenant and repo.
- **Portable export.** One command exports the brain as markdown files plus a generated `AGENTS.md`, readable by any tool.
- **Evals.** A retrieval eval set (task, expected items) runs in CI. "Lessons applied" and "mistakes avoided" are counted toward the never-repeated chart (section 13.2).

Acceptance:
- [ ] Saving a near-duplicate lesson proposes a merge instead of creating a second item.
- [ ] Editing a file linked to a Confirmed item past the staleness threshold flags the item.
- [ ] `get_context` returns the same items for the same task in the extension, the CLI and over MCP.
- [ ] The retrieval eval meets G6 and runs on every PR that touches retrieval code.
- [ ] The markdown export round-trips: importing it into an empty project restores the same Confirmed items and links.
- [ ] No query ever returns another tenant's items (see R-SEC).

#### F8. Reproduce before fixing

- For any bug task, the agent first writes a failing test or script, runs it, and confirms it fails for the reported reason. Only then does it fix. The reproduction is saved as evidence.

Acceptance:
- [ ] On 10 seeded bug tasks, the agent produces a failing reproduction before any source edit in at least 9.
- [ ] The reproduction test is part of the final diff and passes after the fix.

#### F9. Knows the SDLC by default

- Plan, branch, build, test, self-review, PR, changelog entry. The plan is shown before edits in manual and guided modes.

Acceptance:
- [ ] Every agent PR body contains summary, plan, tests added, lessons applied, docs cited and cost.
- [ ] The agent never commits to the default branch; it works on `blame/<task>` branches.

#### F10. Checkpoints and rewind

- Small checkpoint commits on the agent's own branch (or a shadow git ref when the user does not want commits). One action rewinds to any checkpoint in the extension or TUI. History is squashed on merge.

Acceptance:
- [ ] Rewind restores the working tree exactly to the checkpoint (verified by file hash comparison).
- [ ] Rewind never touches files outside the agent's branch or the user's uncommitted work without asking.

#### F11. Docs-first coding

- Before coding against a library, read the pinned version from lock files and fetch that version's docs (Context7 first, official docs page as fallback). Cite the docs in the PR.

Acceptance:
- [ ] For a task using a pinned library, the PR cites a doc URL matching the pinned major version.

#### F12. Skills (MVP: read)

- Reads standard `SKILL.md` and `AGENTS.md` files so existing Cursor and Claude Code skills work as-is.

Acceptance:
- [ ] A skill folder that works in Claude Code loads in Blame without edits.

#### F15. Cost and time guardrails

- Per-task budget, an upfront estimate, a live cost counter and a hard stop. Loop rule (from v0.1): stop when the same test fails with the same error 3 times in a row, or when 2 consecutive checkpoints produce identical diffs.

Acceptance:
- [ ] A task with a $0.50 budget stops before exceeding it, with a clear message.
- [ ] The loop detector stops a seeded infinite-retry task within the rule above.

#### F16. Ask, don't guess (MVP: in-app)

- When the task is ambiguous, the agent asks one focused question in the chat panel or TUI instead of guessing.

Acceptance:
- [ ] On 5 deliberately ambiguous prompts, the agent asks before editing in at least 4.

#### F17. Secrets handled safely

- Provider keys live in VS Code SecretStorage or the OS keychain, never in plaintext files, settings JSON, logs or telemetry.
- The agent never sees raw keys; the runner injects them into the provider call only.
- gitleaks runs before every agent commit and on every PR; a hit blocks the commit.
- `.env` and similar files are kept out of git and out of model context by default.

Acceptance:
- [ ] A test that plants a fake key in a file the agent reads confirms the key is redacted from model context, logs and the learning record.
- [ ] An agent commit containing a planted secret is blocked.

#### F18. Safe zones

- Path patterns (for example `payments/**`, `auth/**`, `migrations/**`) that always need human approval, at every trust level and in every preset, including autonomous.

Acceptance:
- [ ] In autonomous mode at L3, an edit to a safe-zone path pauses for approval. There is no setting that disables this.
- [ ] One approval covers one action: one file write or one command, showing its diff or command line. A new action in a safe zone asks again, even later in the same session (Proposal, pending D8).

#### F23. Works where you are

**F23.1 VS Code extension (`apps/vscode`).** Runs Pi locally. Works in VS Code, Cursor and Windsurf, published to both the VS Code Marketplace and Open VSX (Cursor and Windsurf install from Open VSX).
- Chat panel, inline diffs with accept or reject per hunk, autonomy toggle in the panel header and status bar, trust level badge, proof record view (lessons, chart, evidence), checkpoint timeline with rewind, approval prompts.

Acceptance:
- [ ] Installs and completes a first task in VS Code, Cursor and Windsurf on Windows, macOS and Linux (at least Windows plus one other OS for FUR).
- [ ] Every webview passes keyboard navigation and WCAG AA contrast with the Blame palette.
- [ ] Switching the autonomy preset takes effect on the next tool call without restarting.

**F23.2 Terminal app (`apps/cli`).** Own custom full-screen TUI. Interaction model inspired by Claude Code: a bordered prompt box at the bottom, streaming responses above, tool calls shown as compact collapsible blocks, colored diffs, slash commands (for example `/model`, `/mode`, `/rewind`, `/lessons`, `/review`), inline permission prompts, and a status line showing model, autonomy preset, trust level and session cost. A keyboard shortcut cycles autonomy presets. Uses the Blame ANSI palette (section 9.2).
- Install with one command (for example `npm i -g` of the CLI package; final package name depends on D1).
- Non-interactive mode for scripts and CI (`blame run "task" --mode guided --json`).

Acceptance:
- [ ] Renders correctly in Windows Terminal, macOS Terminal, iTerm2 and the VS Code integrated terminal at 80 columns and wider.
- [ ] Falls back to readable output when colors are off (`NO_COLOR`) or the terminal is not a TTY.
- [ ] Every interactive action has a keyboard path; nothing requires a mouse.

**F23.3 Website (`apps/web`).** Marketing site with install instructions for the extension and the CLI, the BYOK and ChatGPT sign-in explanation, privacy and data retention page, and a thin proof page (a public, opt-in share of a project's never-repeated chart). Built with Next.js, Tailwind and shadcn/ui following `DESIGN.md`.

Acceptance:
- [ ] Passes keyboard, contrast and mobile checks (Playwright screenshots at 375, 768 and 1440 widths).
- [ ] Impeccable detector runs in CI with no unresolved findings on named screens.
- [ ] Install instructions are tested end to end on a clean machine before launch.

**F23.4 MCP server.** Exposes `get_context`, `search_brain`, `record_failure` and `check_action` to Cursor, Claude Code and other MCP clients.

Acceptance:
- [ ] Tested from Cursor and Claude Code with the config snippet shown on the website.

**F23.5 GitHub App.** Captures failures (reverts, unmerged closes, changes requested, CI failures) and posts F24 reviews. Installed per repo, never org-wide by default.

Acceptance:
- [ ] Webhook signatures are verified; unsigned requests are rejected.
- [ ] Installation tokens are short-lived and never stored in logs.

#### F24. Independent AI review (new)

Only the parts that v0.1 did not already cover. Inspired by the Greptile-style review loop.

- **Separate reviewer on every agent PR,** including PRs from Cursor, Claude Code or any other agent. It runs as a different agent configuration from the one that wrote the code (different prompt and, where the user allows, a different model).
- **Self-updating codebase index.** For each repo: how the main parts work, their dependencies, and past bugs (linked to F6 items). Updated incrementally on every merge.
- **Cross-file bug detection.** The reviewer checks changes against callers, callees and related files, not just the diff.
- **One-click handoff.** Each review comment has a "Fix with agent" action that sends the exact file, line range and finding to the coding agent (Blame's agent, or a copy-ready prompt for Cursor or Claude Code).
- **Confirmed bug becomes a lesson.** When a human confirms a finding (or the fix merges), it becomes an F3 failure and a draft lesson.
- **Planted-bug benchmark.** A benchmark of real repos with planted bugs (off-by-one, missing auth check, wrong error handling, cross-file contract breaks) measures catch rate and false-positive rate. Results are published with the method. We do not compare against Greptile's numbers; their "82% vs 44%" figure is their own unverified marketing claim.

Acceptance:
- [ ] A PR opened by a non-Blame agent in a connected repo gets a review within 5 minutes (p90).
- [ ] On the planted-bug benchmark, the reviewer meets G5.
- [ ] At least one planted bug that requires reading a second file is caught.
- [ ] "Fix with agent" opens Blame's agent with the correct file and line range preloaded.
- [ ] A confirmed finding produces a draft lesson linked to the PR and the finding.
- [ ] The index updates after a merge without a full rebuild.

#### F7. Self-maintaining APIs (MVP, cut-list candidate)

- Detect APIs used (Stripe, OpenAI, Twilio first), watch their changelogs, find affected calls, open tested fix PRs that cite the changelog entry.

Acceptance (if kept in MVP):
- [ ] At least one real API-change PR merged on a real repo.

### 7.3 How lesson status and knowledge status fit together

A lesson is a knowledge item, so it has two independent statuses:

| Status track | Values | Meaning |
|---|---|---|
| Knowledge lifecycle (F6) | Draft, Confirmed, Superseded | Is this item true and approved? Superseded when merged into or replaced by another item |
| Proof status (F3) | Active, Proven, Regressed | Is the lesson working? Only Confirmed lessons enter this track |

### 7.4 Next and Later features (short)

| ID | Feature | Phase | Note |
|---|---|---|---|
| F1 | Skills test on onboarding | Next | 3 tasks from closed issues or reverted commits, graded by the repo's tests |
| F4 | Weekly performance review, alerts | Next | Queries over the audit log |
| F5 | Transfer knowledge or wipe on offboard | Next | Uses the F6 export |
| F12 | Share learned skills across a team | Next | |
| F13 | Plain-English mode | Next | A toggle, not a separate product |
| F14 | Live preview per change | Next | Preview link and Playwright before and after screenshots |
| F16 | Ask via phone or Slack | Next | |
| F19 | Morning recap | Next | |
| F20 | Team handoff and multiplayer | Later | |
| F21 | Deploy and roll back | Later | Unlocks L4 |
| F22 | Dependency health | Later | |
| F23 | Slack app, desktop app or fork reusing `packages/core` | Next, Later | |
| (none) | Fine-tuning on confirmed lessons and review outcomes | Later | |
| (none) | Hosted sandbox for remote tasks | Next | Cut-list item |

## 8. Cross-cutting requirements

### 8.1 Models and keys (R-BYOK)

| ID | Requirement |
|---|---|
| R-BYOK-1 | Bring-your-own-key is the default. Supported at launch: any provider Pi supports, with OpenAI, Anthropic, Google and OpenRouter tested in CI (**Proposal**: final list in TRD) |
| R-BYOK-2 | OpenAI Plus, Pro and Business users can choose "Sign in with ChatGPT" to use their Codex allowance through Pi. Re-check OpenAI's partner terms before launch and before every major release |
| R-BYOK-3 | Claude users connect with an Anthropic API key only. Blame never asks for, stores or uses a Claude.ai login or subscription, and never launches or drives the user's Claude Code install |
| R-BYOK-4 | Keys are stored in VS Code SecretStorage (extension) or the OS keychain (CLI). Never in plaintext config, logs, telemetry, the repo or Blame's servers, unless the user opts in to the hosted reviewer (then envelope-encrypted per tenant, see R-SEC) |
| R-BYOK-5 | The UI always shows which provider and model a task uses and what it has cost so far |
| R-BYOK-6 | The reviewer (F24) can use a different provider or model from the coding agent, chosen by the user |

### 8.2 Autonomy presets (R-AUTO)

The preset is what the user asks for. The trust level is what the agent has earned. The effective permission is the lower of the two, and safe zones always win.

| Preset | Maps to | Agent behavior | Sandbox enforcement |
|---|---|---|---|
| Manual | L0 to L1 | Proposes every edit and command; the user approves each one | Read-only by default; writes only after approval |
| Guided (default) | L1 to L2 | Edits files in the workspace with checkpoints; runs allow-listed commands (tests, linters, builds); asks for anything else | Writes limited to the workspace; network off except model provider and docs |
| Autonomous | L2 to L3 (L4 Later) | Runs the full SDLC loop, installs dependencies, opens PRs, within its earned level | Runs inside the sandboxed runner: no host mounts outside the workspace, egress allow-list, CPU, memory and time limits |

| ID | Requirement |
|---|---|
| R-AUTO-1 | Autonomous mode requires an explicit opt-in per workspace and is off by default |
| R-AUTO-2 | Effective permission = min(preset ceiling, earned trust level), then safe zones, then budget, then credential scope. All checks must pass |
| R-AUTO-3 | Safe zones (F18) always need a human, in every preset, with no override |
| R-AUTO-4 | Autonomous mode refuses to start if the sandbox is unavailable. It never falls back to unsandboxed execution |
| R-AUTO-5 | The current preset and trust level are always visible (extension status bar, TUI status line) using the trust ramp colors |
| R-AUTO-6 | Every preset change is an audit event |

### 8.3 Security and tenant isolation (R-SEC, MVP)

Promoted from "Suggested" in v0.1 to MVP requirements.

| ID | Requirement |
|---|---|
| R-SEC-1 | Every stored row (knowledge items, lessons, failures, events, index chunks, embeddings) carries a tenant ID and repo ID. Postgres row-level security enforces tenant scope on every query |
| R-SEC-2 | Retrieval, search and the codebase index can never return another tenant's data. An automated cross-tenant test suite runs in CI and must pass for every release |
| R-SEC-3 | Secrets the service must hold (GitHub App private key, opted-in reviewer keys) are envelope-encrypted with a per-tenant data key |
| R-SEC-4 | GitHub App installs are per repo, least privilege; installation tokens are short-lived and never logged |
| R-SEC-5 | Repo content, PR text and issue text are treated as untrusted input. Prompt-injection tests (for example a README telling the agent to exfiltrate keys) are part of the eval suite |
| R-SEC-6 | gitleaks secret scan on every agent commit and every PR |
| R-SEC-7 | `security-audit` review (Forge, with Davinci) before the FUR and before the MVP launch, recorded in `SECURITY.md` |

### 8.4 Data retention and privacy (R-RET, MVP)

Default values are **Proposals** for David to confirm.

| ID | Requirement | Proposed default |
|---|---|---|
| R-RET-1 | A plain-language data page on the website and in the extension says exactly what leaves the user's machine and where it goes | Ships with FUR |
| R-RET-2 | With BYOK, prompts and code go from the user's machine straight to their model provider. Blame's servers do not see them unless the user enables a hosted feature | Local-first by default |
| R-RET-3 | Evidence excerpts (diff hunks, log lines, review text) are stored only as excerpts, not full files | Excerpts up to about 200 lines each |
| R-RET-4 | Raw evidence and audit events are deleted after a retention window | 90 days (free), configurable later |
| R-RET-5 | Lessons and knowledge items are kept until the user deletes them or offboards with wipe | Until deleted |
| R-RET-6 | Codebase index chunks for a repo are deleted when the repo is disconnected | Within 24 hours |
| R-RET-7 | Account deletion removes all tenant data, including backups after their rotation | Within 30 days |
| R-RET-8 | Product telemetry is opt-in, contains no code, prompts or keys, and can be turned off | Off by default |

### 8.5 Performance (R-PERF)

| ID | Requirement | Target (**Proposal**) |
|---|---|---|
| R-PERF-1 | Context injection before a task | Under 1.5 s p90 |
| R-PERF-2 | Brain search | Under 500 ms p90 for 10k items |
| R-PERF-3 | F24 review on a typical PR (under 500 changed lines) | Under 5 min p90 |
| R-PERF-4 | TUI input latency | No visible lag while streaming (under 50 ms keystroke echo) |
| R-PERF-5 | Extension activation | Under 1 s, no work on activation beyond registering commands |

### 8.6 Accessibility and UX (R-A11Y)

- Keyboard path for every action in the extension, TUI and website.
- WCAG AA contrast for all text on Blame surfaces. Status colors are never the only signal; each status also has an icon or label.
- `NO_COLOR` and screen-reader-friendly plain output mode in the CLI.

### 8.7 Observability (R-OBS)

- Structured logs with request IDs on the backend; error tracking on a free tier (Sentry free plan, **Proposal**).
- Every agent action is in the audit log (F4). Every status claim in a PR lists the command run and its result.

### 8.8 Production readiness tier

MVP tier ("real users, small scale"): 5 design partners, under 50 repos, under 1,000 tasks a month. One Postgres database (with pgvector, pending Week 0 check), one API service, one worker. CI on GitHub Actions. No Redis, no separate vector database. Revisit at 50 active teams.

## 9. Brand and design

### 9.1 Name and voice

- Product name: **Blame**. Searchability concern and suggested qualifiers are in D1.
- Voice: direct, honest, a little dry. Blame owns mistakes instead of hiding them. No hype words, no em dashes in product copy.

### 9.2 Palette

Built from the final logo: three dark blues, a lavender accent and white. Everything is a tint or shade of that purple-blue family, except status colors, which are muted and only ever mean status.

**Foundation**

| Token | Hex | Use |
|---|---|---|
| Abyss | #04052E | App background, terminal background |
| Deep Twilight | #140152 | Panels, cards, sidebar |
| Navy | #22007C | Elevated surfaces, hover states, selected rows |
| Lavender | #B9C2FF | Primary accent: links, focus rings, active states, icon family |
| White | #FFFFFF | Wordmark, headings |

**Text and chrome**

| Token | Hex |
|---|---|
| Text primary | #F2F0FF |
| Text secondary | #A9A7CC |
| Text muted | #8A88AA (lightened from Muse's #6E6C94 for contrast; final value in `DESIGN.md`) |
| Border subtle | #26245F |
| Border strong | #3B3790 |

**Status (status only, never decoration)**

| Token | Hex |
|---|---|
| Success | #3ECF8E |
| Warning | #F5B544 |
| Error | #FF6B6B |
| Info | #6EA8FF |

**Terminal (ANSI 16)**

| Slot | Normal | Bright |
|---|---|---|
| Background | #04052E | |
| Foreground | #E8E6FF | |
| Cursor | #B9C2FF | |
| Selection | #22007C | |
| Black | #04052E | #4A4878 |
| Red | #FF6B6B | #FF8A8A |
| Green | #3ECF8E | #6FE3AE |
| Yellow | #F5B544 | #FFC95E |
| Blue | #6EA8FF | #8FBFFF |
| Magenta | #B18CFF | #CDB4FF |
| Cyan | #6ED3D3 | #8FE3E3 |
| White | #E8E6FF | #FFFFFF |

### 9.3 Trust ramp

Trust literally brightens as it is earned. Used for the trust badge in the extension, the TUI status line and the proof page.

| Level | Hex |
|---|---|
| L0 | #8A88AA |
| L1 | #8B7CFF |
| L2 | #A29FFF |
| L3 | #B9C2FF |
| L4 | #FFFFFF |

Each step is brighter than the last, no step reuses a status color, and all pass 4.5:1 on every surface. These replace Muse's original ramp, whose L1 matched the Info color and whose L3 was darker than L2. `DESIGN.md` holds the final values.

### 9.4 Design ownership

- `DESIGN.md` (Davinci) is the single design source for the website, extension webviews and TUI tokens. It is built with Impeccable (installed per project, live Apply off) and awesome-design-md (pinned upstream SHA, adapted into Blame's own identity, not copied). This PRD does not repeat its rules.
- Terminal: Claude Code is the reference for interaction feel (layout, prompt box, tool blocks, permission prompts, status line). Blame uses its own palette, wordmark and copy.
- Extension: held to the same quality bar as the website. Webviews use the same tokens, respect the editor's font settings, and are reviewed with Impeccable `critique` and `audit` before release.

## 10. Key user flows

Detailed screen flows live in `APP_FLOW.md`. These are the journeys the MVP must support.

**Flow A: Install and first task (extension).** Install from the VS Code Marketplace or Open VSX, open the Blame panel, choose a provider (paste API key or Sign in with ChatGPT), pick a preset (Guided is the default), Blame scans the repo and proposes `AGENTS.md`, run a first task, review the diff, accept.

**Flow B: Install and first task (CLI).** Install with one command, run `blame` in a repo, same provider and preset choice in the TUI, same scan, task, diff and accept.

**Flow C: Failure to lesson to proof.** A failure happens (revert, failing test, review, confirmed F24 bug). Blame drafts a lesson and regression test with evidence. The user confirms or edits. The test lands through a PR. Later tasks get the lesson injected. The chart updates by the rule in 13.2.

**Flow D: Task with autonomy.** The user sets Autonomous (opt-in), the agent plans, branches, reproduces (bugs), checks docs, builds with checkpoints, runs tests, self-reviews, opens a PR. Any risky action or safe-zone edit pauses for approval.

**Flow E: Independent review.** Any agent opens a PR. The GitHub App triggers the F24 reviewer. Findings appear as PR comments with "Fix with agent". The user clicks it, Blame's agent opens with the file and line loaded, fixes, and pushes to the same branch. The confirmed finding becomes a draft lesson.

**Flow F: Companion mode.** A Cursor or Claude Code user adds the Blame MCP config from the website. Their agent calls `get_context` and receives Confirmed lessons. Their PRs get F24 reviews.

**Flow G: Rewind.** The user opens the checkpoint timeline in the panel or types `/rewind`, previews a checkpoint diff, and restores it.

**Flow H: Revoke.** The user runs revoke from the extension or `blame revoke`. Every credential is revoked and listed with its time.

### 10.1 User stories (MVP)

- As a solo developer, I install the extension in Cursor, paste my OpenAI key, and finish a first task in under 10 minutes.
- As a ChatGPT Plus user, I sign in with ChatGPT and use my Codex allowance instead of paying for API tokens.
- As a Claude user, I paste an Anthropic API key, and Blame tells me clearly why my Claude.ai subscription cannot be used.
- As a developer, when my PR is reverted, I see a draft lesson and a regression test with evidence the same day.
- As a developer using Claude Code, my agent's PRs get an independent Blame review, and I click "Fix with agent" on a finding.
- As a vibe coder, I stay in Guided mode, and Blame asks before running anything outside my project.
- As a team lead, I mark `payments/**` as a safe zone, and no agent edits it without my approval, even in autonomous mode.
- As a developer, I export the brain as markdown and `AGENTS.md` and use it in another tool.

## 11. Architecture at a glance

Owned by Forge in `ARCHITECTURE.md` and the ADRs. Listed here only so the PRD is readable on its own.

| Part | Path | Role |
|---|---|---|
| Core | `packages/core` | Pi integration, Blame tools (lesson retrieval, risky-action check), reproduce-before-fix and regression-test generation, prompts and skills, guardrails, autonomy and trust checks, sandboxed runner interface, eval harness |
| Extension | `apps/vscode` | VS Code extension UI over core; runs Pi locally |
| CLI | `apps/cli` | Custom TUI and non-interactive mode over core |
| Website | `apps/web` | Marketing site, install docs, data page, thin proof page |
| Backend | (path in TRD) | Learning record and brain store (Postgres with pgvector and full-text search), MCP server, GitHub App webhooks, F24 reviewer and codebase index |

ADRs Forge owns (from the skill plan): Pi versus a custom loop (decided, record it), TUI framework, index storage, extension versus fork (decided for MVP: extension), where the reviewer runs (Blame backend versus a GitHub Action in the user's repo with their own key; **Proposal**: start with the GitHub Action because it costs David nothing and keeps code in the user's CI).

## 12. Timeline, milestones and cut list

### 12.1 Why the timeline changed

v0.1 promised about 3 weeks for roughly 11 MVP items. v0.2 adds an extension, a custom TUI, a sandbox that enforces autonomy, the second brain and an independent reviewer. For one builder with AI help, the full MVP is realistically **8 to 10 weeks** after Week 0. A first usable release at the **end of week 6** needs the cut list in 12.3.

### 12.2 Week 0 (this week and next, before building)

| ID | Task | Owner | Done when |
|---|---|---|---|
| W0-1 | Resolve free-tier unknowns: does the InsForge free plan support pgvector and background workers, and what are its limits? | Forge | Written answer with source links in `TRD.md` |
| W0-2 | Decide where the sandbox runs: local Docker or OS-level sandbox on the user's machine for MVP (**Proposal**), hosted sandbox later | Forge | ADR merged |
| W0-3 | Decide where the F24 reviewer runs (12.3 proposal: GitHub Action with user's key) | Forge | ADR merged |
| W0-4 | Confirm Pi license, provider coverage and the ChatGPT sign-in partner terms; confirm Anthropic's Claude Code legal terms wording | Forge, Atlas | Links and quotes recorded in `TRD.md` |
| W0-5 | Define "never repeated" fairly (section 13.2 draft) and get David's yes | Atlas | Rule approved and logged in change log |
| W0-6 | Build the first eval sets: 20 seeded bug tasks, 30 retrieval cases, 25 planted bugs for F24 | Forge, Cortex | Eval sets committed with a runner |
| W0-7 | Draft design-partner outreach (target list criteria, DM and email drafts). **Drafts only; nobody is contacted until David approves each message** | Atlas | Drafts in `docs/gtm/outreach-drafts.md` |
| W0-8 | Name searchability check for D1 (domain, npm, marketplaces, GitHub handle) | Atlas | Options table for David |
| W0-9 | TRD, ARCHITECTURE, APP_FLOW, IMPLEMENTATION_PLAN, DESIGN, AGENTS, TESTING docs drafted | Forge, Atlas, Davinci | Docs merged through PRs |

Design-partner outreach then **starts in Week 1** (moved from Week 3 in v0.1), once David approves the drafts.

### 12.3 MVP cut list (Proposal, pending David's yes)

To reach a first usable release (FUR) at the end of week 6, defer these until after FUR:

| # | Defer | Why it is safe to defer | What FUR keeps instead |
|---|---|---|---|
| C1 | F7 API watch | Not needed to prove the core loop; changelog parsing is its own project | Nothing; returns in MVP weeks 7 to 10 or Next |
| C2 | F4 weekly reviews and alerts | Queries over the audit log; easy to add later | Audit log and approvals |
| C3 | F14 live preview | Already Next in v0.1; needs hosting per PR | Diffs and test results in the panel and TUI |
| C4 | Hosted sandbox | Costs money and adds an attack surface | Local sandbox on the user's machine |
| C5 | Web dashboard beyond the install page and a thin proof page | The editor and terminal are where the work happens | Proof record view inside the extension and `blame lessons` in the CLI |
| C6 | F24 full scope | Index and cross-file detection are the hardest parts | Thin F24 in week 7, first after FUR: review on PRs in connected repos with a file-level index, "Fix with agent", confirmed finding to lesson, planted-bug benchmark of 25 bugs |
| C7 | Windsurf and Linux certification for the extension | Same extension; fewer test matrices | VS Code and Cursor on Windows plus one other OS |
| C8 | F5 revoke for the ChatGPT session | Users can sign out in the provider settings | Revoke for MCP tokens, GitHub App access and stored keys |

### 12.4 Milestones (full MVP)

Weeks start after Week 0. Each milestone ends with a verification check that can be run and shown.

| Weeks | Milestone | Main work | Exit check |
|---|---|---|---|
| 1 | Setup and Pi spike | Repo scaffold and CI, Pi spike with BYOK, partner track starts (target list and outreach drafts, David approves every message) | Pi runs a tool-calling task from `packages/core` in CI; outreach drafts are ready for David |
| 2 to 3 | Core and CLI | `packages/core` on Pi: guardrails (F15), reproduce-before-fix (F8), SDLC loop (F9), docs-first (F11), local brain; CLI TUI v0 with palette in week 3. BYOK and ChatGPT sign-in (DEC-8) | A seeded bug task in the CLI produces a failing reproduction, a fix and a PR on a test repo, with cost shown |
| 4 to 5 | Extension, autonomy and install pages | Static install, BYOK and data pages in week 4; `apps/vscode` chat panel, diffs, checkpoints (F10), presets and trust (F2, R-AUTO), safe zones (F18), local sandbox, secrets (F17), audit log (F4); first partner installs on the CLI | Same task in VS Code and Cursor in all three presets; sandbox escape tests pass; install page live |
| 5 to 6 | Backend, learning record and brain (**FUR at end of week 6 if cut list approved**) | Backend and MCP server (stdio first), F3 lessons and regression tests, F6 brain (links, lifecycle, dedupe, staleness, injection, hybrid search, export) | A repeated mistake is prevented or caught and the chart shows it; retrieval eval meets G6; 2 design partners installed |
| 7 to 8 | Independent review | Thin F24 first in week 7, then full F24: self-updating index, cross-file detection, benchmark at 25 or more bugs; GitHub App failure capture; thin proof page | Reviewer meets G5 on the benchmark; a Claude Code PR gets a review and a one-click fix |
| 9 to 10 | Hardening and partners | Security audit, R-SEC cross-tenant suite, R-RET deletion jobs, F7 if kept, polish with Impeccable, demo video | 5 design partners active; release gates in 12.5 pass |

If David wants the thin F24 inside the FUR, something else has to come out of weeks 5 to 6. The suggested cut is the HTTP MCP transport, keeping stdio only.

### 12.5 Release gates (from Davinci's plan)

1. The agent works end to end in the extension and the TUI with a user's own key, in all three presets, with autonomous gated by explicit opt-in.
2. The reviewer catches planted bugs on the benchmark, and "Fix with agent" lands a correct patch.
3. No key or secret reaches logs, telemetry, the learning record or the repo.
4. The website passes keyboard, contrast and mobile checks with screenshots.
5. CI is green on lockfile builds, and every status claim lists the command and result.
6. The cross-tenant isolation suite passes (added in v0.2).

### 12.6 Demo plan (60 seconds)

0 to 15 s: a bug report; Blame writes a failing test first. 15 to 30 s: it pulls the pinned version's docs and cites them. 30 to 40 s: it goes wrong, one keystroke rewinds. 40 to 50 s: a Claude Code PR gets a Blame review, "Fix with agent". 50 to 60 s: the never-repeated chart and the trust badge brightening from L1 to L2.

## 13. Success metrics

### 13.1 Metrics

| Metric | Definition | MVP target (**Proposal** unless noted) |
|---|---|---|
| Active partners | Partners with at least 3 Blame tasks or reviews a week | 5 (source goal) |
| Time to first task | Install to first accepted diff | Under 10 minutes |
| Lessons proven | Lessons that reached Proven under 13.2 | 20 across partners |
| Mistakes avoided | See 13.2 | Reported, rising week over week |
| Repeat-mistake rate | Failures matching an existing Confirmed lesson / all failures | Falling week over week |
| Reviewer catch rate | Planted bugs caught / planted bugs | 60% or more |
| Reviewer noise | False-positive comments per PR | 1 or fewer on average |
| Fix-with-agent success | One-click fixes merged / one-click fixes started | 50% or more |
| Retrieval recall@5 | Eval cases with the expected item in the top 5 | 80% or more |
| PR merge rate | Blame agent PRs merged / opened | Over 60% |
| Revert rate | Blame agent PRs reverted / merged | Under 5% |
| Week 4 retention | Partners active in week 4 / partners onboarded | 4 of 5 |

### 13.2 "Never repeated", defined fairly (draft for W0-5)

The chart is the core proof, so the rule must be strict, public and shown in the product.

- **Mistake class.** One Confirmed lesson defines one class: its rule plus its scope (file paths) plus its fingerprint (error type, area, rule broken).
- **Exposure is required.** A lesson cannot be Proven just because nothing happened. It needs at least 5 later agent tasks that touched its scope (from any agent: Blame, Cursor, Claude Code).
- **Proven** when, over at least 14 days and 5 exposures: its regression test passed on every agent change in scope, and no matching failure was recorded.
- **Regressed** on any matching failure. The chart shows regressions; they are never hidden.
- **Lessons applied** counts when the lesson was injected into a task that touched its scope.
- **Mistakes avoided** counts only when a check fired before merge: the lesson's regression test failed on an agent change, the risky-action check blocked an action linked to the lesson, or F24 flagged it and the human confirmed. Injection alone does not count as avoided.
- **Denominator shown.** The chart shows all Confirmed lessons, including ones still waiting for exposure, so the proven share is honest.
- **Every point links to evidence** (the test run, the blocked action, the review comment).

## 14. Pricing and business model

- Bring-your-own-key means Blame does not pay for model tokens in the MVP.
- Design partners get Blame free in exchange for weekly feedback.
- **Proposal**: free for solo use (local agent, local brain, 1 connected repo for F24). Paid team plan per seat for shared brain, F24 on all repos, audit export. Price points are still open (Q2).
- Later: update agents sold to API providers (F7).

## 15. Go-to-market

- First users: solo developers and small teams already using Cursor, VS Code or a terminal agent.
- Channels (**Proposal**): X, YC and speedrun communities, Cursor and Claude Code communities, MCP directories, Open VSX and VS Code Marketplace listings, posting real never-repeated charts from partners (with permission).
- Open-source the export format and the `AGENTS.md` generator to back the neutrality claim.
- Design-partner outreach starts in Week 1 from drafts David has approved. Atlas prepares the drafts; nobody contacts anyone without David's explicit yes on each message.

## 16. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Solo-builder bandwidth; the MVP slips past 10 weeks | Approve the cut list; hold scope fixed; every new idea goes to Next |
| Provider terms change (ChatGPT sign-in, Anthropic policies) | BYOK API keys always work; re-check terms each release (R-BYOK-2) |
| Pi changes its API or slows down | Pin versions; wrap Pi behind `packages/core` interfaces; MIT license allows a fork |
| Platforms (Cursor, Anthropic, OpenAI) ship similar memory or review | Neutrality, portable export, published proof and benchmark |
| "Never repeated" looks gamed | Strict public rule in 13.2, exposure requirement, evidence links, regressions shown |
| Reviewer is noisy, users mute it | Noise metric with a target; confirmed-finding feedback loop; benchmark before launch |
| Sandbox escape or credential misuse in autonomous mode | Autonomous refuses without sandbox; escape test suite; egress allow-list; safe zones |
| Prompt injection via repo or PR text | Treat all repo text as untrusted; injection tests in evals; risky-action check |
| Cross-tenant data leak | Row-level security, cross-tenant CI suite as a release gate |
| Free-tier limits (InsForge, GitHub Actions) | Week 0 check; local-first design; reviewer as a GitHub Action in the user's repo |
| The name "Blame" is hard to search | D1 qualifier for domain, npm and marketplaces |
| Lessons are noisy or wrong | Human confirmation, dedupe, staleness flags, regression test required |

## 17. Open decisions and questions

### 17.1 Decisions for David

| ID | Decision | Options and Atlas's suggestion |
|---|---|---|
| D1 | **Name searchability.** Decided in DEC-9 | Atlas runs availability checks for "Blame AI" handles, domains and package scopes in W0-8, then brings the options to David |
| D2 | **Repo name.** Done: `dbustosjr/blame` | None |
| D3 | **Cut list approval** (section 12.3, C1 to C8) | Approve all, approve some, or keep the full 8 to 10 week MVP before any release |
| D4 | **YC application date** | Needed to plan the 5-partner goal backward. If the date is under 8 weeks away, the cut list is required |
| D5 | **"Never repeated" rule** (13.2) | Approve as drafted or adjust the 14 days and 5 exposures |
| D6 | **Continuity with the November 8 scope** (proof-of-done and decision inbox) | Atlas suggests reusing its evidence-backed proof ideas in F3 and F24 and retiring the rest; confirm |
| D7 | **Retention defaults** (R-RET) | Approve 90 days for evidence and events, deletion windows as listed |
| D8 | **Safe-zone approval scope** (F18) | Recommend one approval per action for MVP. A per-session approval (same path pattern, ends when the session closes, logged) can come later if design partners find per-action approvals too noisy |

### 17.2 Open questions (carried from v0.1, updated)

| ID | Question | Status |
|---|---|---|
| Q1 | Product name | **Answered**: Blame (searchability in D1) |
| Q2 | Price points for team seats | Open |
| Q3 | Which 2 to 3 APIs ship first in F7 | Open; depends on D3 |
| Q4 | Which tool to support first in companion mode | **Answered**: both Cursor and Claude Code through MCP and F24 |
| Q5 | Where the sandbox runs on free tiers | Week 0 (W0-2); proposal: local |
| Q6 | InsForge free plan support for pgvector and workers | Week 0 (W0-1) |
| Q7 | Default model and key model | **Answered**: BYOK default, ChatGPT sign-in supported, Claude via API key only. Default embedding model still open |
| Q8 | Exact rule for "stopped recurring" | Drafted in 13.2, pending D5 |
| Q9 | Default N for trust promotion | Proposal N = 10; confirm |
| Q10 | What data leaves the repo, and retention | Drafted in R-RET, pending D7 |
| Q11 | Size range of a "small team" | Open; validate with design partners |
| Q12 | Where the F24 reviewer runs | Week 0 (W0-3); proposal: GitHub Action |
| Q13 | TUI framework (Pi's own TUI components or another library) | Forge ADR |
| Q14 | Which competitor claims can be verified for the pitch | Atlas and Forge before any deck |

## 18. Change log

| Version | Date | Author | Summary |
|---|---|---|---|
| v0.1 | November 13, 2026 | David Bustos Jr | First draft: thesis, F1 to F23, architecture, systems design, 3-week MVP plan |
| v0.2 | November 13, 2026 | Atlas for David | See the list below |

**What changed from v0.1 to v0.2**

1. Product named **Blame** (was "Working name" and room name "Project Mercury").
2. Agent engine set to **Pi** plus Blame's layer (DEC-1). LangChain and the Claude Agent SDK ruled out. Fine-tuning moved to Later.
3. **Bring-your-own-key** is the default; ChatGPT sign-in supported; Claude via API key only; no launching the user's Claude Code (DEC-2, R-BYOK).
4. Surfaces rewritten: VS Code extension (VS Code, Cursor, Windsurf), CLI with a custom TUI styled after Claude Code's interaction model, marketing website. Repo layout `apps/cli`, `apps/vscode`, `apps/web`, `packages/core`. The web dashboard is no longer the main surface.
5. Resolved the "two products in one" tension: Blame's own agent leads; companion mode is MCP context plus F24 review, with its limits stated (section 6.1).
6. **Autonomy presets** (manual, guided, autonomous) mapped onto L0 to L4 with sandbox enforcement (R-AUTO). F2 and F18 promoted to MVP.
7. **Second brain** (F6) promoted to MVP with Cortex's design: links, lifecycle, dedupe, staleness, auto-injection, hybrid search, markdown export, retrieval evals.
8. **New F24 Independent AI review**: reviewer on every agent PR, self-updating index, cross-file detection, one-click fix handoff, findings become lessons, planted-bug benchmark.
9. **Tenant isolation and data retention** promoted to MVP requirements (R-SEC, R-RET).
10. Added success criteria per goal, explicit non-goals NG1 to NG10, and acceptance criteria for every MVP feature.
11. **Timeline**: MVP is now 8 to 10 weeks plus Week 0, with a proposed cut list for a first usable release at the end of week 6.
12. Added Week 0 tasks: free-tier unknowns, sandbox and reviewer location, terms checks, fair "never repeated" rule, eval sets, outreach drafts. Outreach moved from Week 3 to Week 1.
13. Drafted a strict "never repeated" rule with exposure requirement and a separate "mistakes avoided" count.
14. Added the brand palette, terminal ANSI palette and trust ramp; design ownership pointed to `DESIGN.md`.
15. Competitor claims marked Unverified; Greptile's 82% vs 44% labeled as their own marketing claim.
16. Systems design detail (schema, REST endpoints, MCP tool shapes, jobs) moved out of the PRD to `TRD.md` and `ARCHITECTURE.md`; v0.1 section 10 is their input.
17. New open decisions D1 to D8 (name searchability, repo name, cut list, YC date, never-repeated rule, November 8 continuity, retention, safe-zone approval scope).

# AGENTS.md

Working rules for coding agents (and people) in the Blame repo. This file says how to work here. What to build lives in the PRD, how it is built lives in the TRD and ARCHITECTURE, and how it looks lives in DESIGN.md. Link to those instead of copying them.

## What Blame is

Blame is a vendor-neutral coding agent that owns its mistakes. It ships as a VS Code extension (VS Code, Cursor, Windsurf) and a terminal app, both built on the open-source Pi agent toolkit with the user's own model key, plus a learning record that turns each failure into a lesson and a regression test, and an independent reviewer (F24) for every agent PR. The stack is TypeScript on Node 22.19+, Python FastAPI, Postgres with pgvector on InsForge, Next.js for the website and GitHub Actions for CI and review.

Status (November 13, 2026): planning. The repo has docs, brand assets and one CI workflow. The Phase 0 monorepo scaffold and CI are in place; no agent features are built yet. The docs below arrive through PRs #1 to #4; read them from those branches until they merge.

## Read before you start

| Doc | Read it when |
|---|---|
| [docs/PRD.md](docs/PRD.md) | Always, first. Feature IDs (F1 to F24), requirement IDs (R-BYOK, R-AUTO, R-SEC, R-RET, R-PERF, R-A11Y, R-OBS), acceptance criteria, cut list, open decisions D1 to D7 |
| [docs/TRD.md](docs/TRD.md) | Before writing any code. Stack, functional requirements (FR-*), REST and MCP contracts, constraints C-1 to C-10 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Before adding a file or package. Folder layout, data flow, SQL schema, sandbox profiles, CI workflows |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Before starting a task. Find the phase it belongs to and its Verify checks. Work one phase at a time. v0.2 schedule: FUR at the end of week 6, thin F24 reviewer in week 7 |
| [docs/REVIEWER_AND_BRAIN.md](docs/REVIEWER_AND_BRAIN.md) | Touching the reviewer, the code index, retrieval, lessons or evals |
| [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) | Touching keys, auth, the sandbox, webhooks, the Action, tenant data or anything that reads repo or PR text |
| [docs/DESIGN.md](docs/DESIGN.md) | Any UI: website, extension webviews, TUI colors and layout |
| [docs/BRAND.md](docs/BRAND.md) and [brand/](brand/) | Logo files and the original palette. DESIGN.md wins on final color values |
| [docs/adr/](docs/adr/) | Before changing a decision. 0001 Pi engine, 0002 TUI on pi-tui, 0003 index and storage, 0004 reviewer as a GitHub Action, 0005 local sandbox (srt) |
| [docs/APP_FLOW.md](docs/APP_FLOW.md) | Building any screen or command. Journeys, states and error branches per surface |
| [docs/TESTING.md](docs/TESTING.md) | Writing tests or claiming something works |

When docs disagree, the order is PRD, then TRD, then the rest. Flag the conflict in your PR instead of picking silently.

## Repo layout

Planned layout from PRD DEC-3 and ARCHITECTURE section 3. Folders appear as phases land.

```
packages/core/          the only package that imports Pi (@earendil-works/*)
packages/api-client/    TypeScript client generated from apps/api/openapi.json
packages/design-tokens/ tokens from DESIGN.md for all surfaces: ANSI palette with fallbacks, CSS vars, later the Pi theme JSON
apps/cli/               `blame` terminal app (Pi interactive mode, Blame theme), runs core in process
apps/vscode/            thin extension host plus React webviews, runs core as a child process over Pi RPC
apps/web/               Next.js website: install, data page, proof page
apps/api/               FastAPI /v1, MCP HTTP endpoint, worker loop
apps/review-action/     the blame-review GitHub Action
functions/github-webhook/  InsForge edge function
db/migrations/          plain SQL, applied from CI only
evals/                  seeded bug tasks, retrieval golden set, planted-bug benchmark, injection cases
docs/                   PRD, TRD, ARCHITECTURE, ADRs, plans
```

Hard rule (TRD TG-1): only `packages/core` imports Pi. CLI and extension hold no agent logic. CI will enforce this with an import-boundary check.

## Commands

What works today:

| Task | Command |
|---|---|
| Install | `pnpm install --frozen-lockfile` (pnpm 10 workspaces, Node 24 per `.nvmrc`, 22.19+ in `engines`) |
| Lint and format | `pnpm lint` (Biome, check only), `pnpm format` (Biome, writes) |
| Typecheck | `pnpm typecheck` |
| Unit tests | `pnpm test` (Vitest in every package, plus the checks in `scripts/`) |
| Build | `pnpm build` |
| Extension integration tests | `xvfb-run -a pnpm --filter blame test:e2e` on Linux (`vscode-test` from `@vscode/test-cli`) |
| Design check | `npx impeccable@4.9.1 detect --github apps/web` (ignores in `.impeccable/config.json`) |
| Import boundary | `pnpm check:boundary` (only `packages/core` may import `@earendil-works/*`) |
| Em and en dash check | `pnpm check:dashes` (Markdown tracked by git) |
| Secret scan | runs in CI as `.github/workflows/secret-scan.yml` (gitleaks) on every PR and push to main |
| CI | `.github/workflows/ci.yml` runs all of the above except the secret scan, on every PR and push to main |

Planned, not yet available (from IMPLEMENTATION_PLAN Phase 0 and ARCHITECTURE section 12). Do not claim these pass until the tooling exists and you ran them:

| Task | Planned command | Planned, not yet available |
|---|---|---|
| Python lint and tests | Ruff and pytest (`apps/api`, uv) | yes |
| Extension integration tests on Windows | `@vscode/test-electron` on a Windows runner | yes |
| Website E2E and screenshots | Playwright at 375, 768, 1440 plus axe | yes |
| Evals | `evals/` TypeScript harness, JSONL results | yes |
| DB migrations | `npx @insforge/cli db migrations up --all`, from CI only, never by hand | yes |
| Product CLI (today only `blame`, `--mode`, `--version` and `--help` exist) | `blame`, `blame run "task" --json`, `blame review`, `blame fix <id>`, `blame lessons`, `blame export`, `blame revoke`, `blame mcp`, `blame init review` | yes |

If you add a real script, update this table in the same PR.

## Guardrails

Git and GitHub
- Work on a branch and open a PR. Never push to `main`, never merge, never force-push a shared branch. David merges.
- Product rule for Blame's own agent: it works on `blame/<task>` branches only and may force-push only branches it created (PRD F9, TRD C-5).
- Never use `pull_request_target` in any workflow. Pin actions by commit SHA (TRD C-7, THREAT_MODEL T-09).

Secrets and keys
- No secrets in code, tests, fixtures, logs, telemetry, PR text or the learning record. Use obviously fake keys in tests and let gitleaks prove it (F17, R-SEC-6).
- BYOK keys are stored only in VS Code SecretStorage (`context.secrets`) in the extension and the OS keychain (`@napi-rs/keyring`) in the CLI. Never in settings JSON, plaintext config or Pi's `auth.json` (R-BYOK-4, TRD FR-KEY-1, FR-KEY-2).
- Claude is API key only. Never add Claude.ai login, subscription use, or code that launches the user's Claude Code (R-BYOK-3, TRD FR-KEY-4).
- `.env*` stays out of git and out of model context. Server secrets go in `.env.example` names only.
- Nothing server-side under `NEXT_PUBLIC_`.

Autonomy and safety (product behavior you must not weaken)
- Effective permission = min(preset ceiling, earned trust), then safe zones, then budget, then credential scope (R-AUTO-2).
- Safe zones (F18, for example `payments/**`, `auth/**`, `migrations/**`) always pause for a human, in every preset and at every level. Never add a setting that turns this off (R-AUTO-3).
- Autonomous is off by default and needs an explicit opt-in per workspace (R-AUTO-1). It refuses to start without the sandbox and never falls back to running unsandboxed (R-AUTO-4).
- Repo files, PR text, review comments, CI logs and fetched docs are untrusted data. They never pick tools (TRD C-6, THREAT_MODEL T-01).
- Presets are Manual, Guided and Autonomous. David confirmed Guided as the middle name on 2026-11-13 (TRD OQ-6, resolved). Keep it a data label, not a code branch.

Impeccable (design tooling)
- Install per project only, and keep live Apply off: `IMPECCABLE_LIVE_COPY_AGENT=off`. Live Apply can launch other agents with approvals bypassed.
- Detector exit codes: 0 = clean, 2 = findings, 1 = scan failure. Never suppress 1 or 2, never mark a UI PR ready on either.
- Impeccable audit is a design check, not a security audit.

Ask David first
- New dependencies, a new package or app, changes to an ADR decision, schema migrations, workflow permissions, anything in auth, keys, sandbox or policy code, deleting files, and anything that touches a decision still open in PRD section 17.

## Definition of done

Code change
- [ ] Maps to a feature or requirement ID (F*, R-*, FR-*) and cites it in the PR body.
- [ ] Tests written for the change and passing; the command and its output are pasted in the PR (IMPLEMENTATION_PLAN project rule).
- [ ] The current phase's Verify checks in IMPLEMENTATION_PLAN pass, with outputs.
- [ ] If it touches a T-ID area, the matching security test exists or is updated (see TESTING.md).
- [ ] Import boundary holds: no Pi import outside `packages/core`.
- [ ] gitleaks is clean. No em dashes in docs or UI copy (TRD C-10).
- [ ] Docs updated in the same PR when behavior, commands or structure change. Decisions get a new or superseding ADR.

UI change (website, extension webview or TUI): everything above plus the [DESIGN.md done checks](docs/DESIGN.md#done-checks-for-any-ui-change):
- [ ] Impeccable detector exits 0.
- [ ] Keyboard-only walkthrough recorded in the PR.
- [ ] Screenshots: website at 1440, 768 and 375; extension in dark, light and high contrast; terminal in truecolor and ANSI 16.
- [ ] Contrast checked for any new color pairing. Tokens only, no ad hoc colors or spacing.
- [ ] Every component has default, hover, focus, active, disabled, loading, empty, error and permission-denied states.

## Verify against official docs

APIs here move fast. Check the current docs before relying on one, and cite the URL in the PR (this is also F11 for Blame's own agent).

- Pi: [README](https://github.com/earendil-works/pi), [SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md), [RPC](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md), [extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md), [TUI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md), [security](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md). Pi versions are pinned exactly; read the docs at the pinned version (TRD C-9).
- VS Code: [Extension API reference](https://code.visualstudio.com/api/references/vscode-api) (SecretStorage, webviews, theme kinds), [Testing extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension).
- Sandbox: [srt README](https://github.com/anthropics/sandbox-runtime), including its Windows limitations.
- GitHub: [webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks), [Actions OIDC](https://docs.github.com/en/actions/concepts/security/openid-connect).
- InsForge: [docs](https://docs.insforge.dev) and [pricing](https://insforge.dev/pricing) for free-tier limits.

If the docs contradict TRD or an ADR, stop and flag it in the PR rather than coding around it.

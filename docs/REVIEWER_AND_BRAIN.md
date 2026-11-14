# Blame: Independent Reviewer (F24) and Second Brain (F6)

Version v0.1, November 13, 2026. Owner: Forge, with Cortex for the brain design. Storage and runtime decisions: [ADR-0003](adr/0003-index-and-retrieval-storage.md), [ADR-0004](adr/0004-reviewer-runtime.md). Schema: [ARCHITECTURE section 6](ARCHITECTURE.md#6-database-and-storage). Product rules: [PRD](PRD.md) F3, F6, F24, section 13.2.

## 1. Success criteria (measurable)

| ID | Criterion | Source |
|---|---|---|
| S1 | Reviewer catches at least 60% of planted bugs with at most 1 false-positive comment per PR on average (Proposal, reset after first run) | PRD G5 |
| S2 | At least one planted bug that needs a second file is caught | PRD F24 |
| S3 | Right lesson in the top 5 injected items for at least 80% of retrieval cases (Proposal) | PRD G6 |
| S4 | Context injection under 1.5 s p90; brain search under 500 ms p90 at 10k items | R-PERF-1, 2 |
| S5 | Zero cross-tenant items in any result | R-SEC-2 |
| S6 | Injection cases: no tool call, secret disclosure or comment content dictated by planted instructions | R-SEC-5 |

Evals are built first (PRD W0-6: 20 seeded bug tasks, 30 retrieval cases, 25 planted bugs) and gate CI from Phase 2 on.

## 2. Codebase index (shared by agent and reviewer)

| Layer | Contents | Built by | Updated |
|---|---|---|---|
| Structure | Files, languages, symbols (functions, classes, exports) via `web-tree-sitter` | core `index/` | Per file, keyed by content hash |
| Dependencies | Import and call edges (best-effort, per language), test-to-source mapping by naming and imports | core `index/` | Same |
| Chunks | Symbol-level chunks (fallback: heading or line windows) with FTS5 and embeddings | core `index/` | Changed files only |
| History | Churn and last authors per file from `git log`; revert and fix commits | core `index/` | On new commits |
| Past bugs | Failure items, confirmed findings and lessons, linked to files and symbols | Brain (remote or local) | On every write |

Self-updating: the agent updates the local index on file save and after each checkpoint; the Action updates it on every PR run and stores it in `actions/cache` keyed by base SHA, so a merge to `main` produces a fresh cache on the next run without a full rebuild (PRD F24 acceptance). Thin F24 for FUR (PRD cut C6) uses the file-level layer only: structure, chunks and past bugs, no call graph.

## 3. Review pipeline

1. **Scope.** Diff from base to head. Skip generated files, lockfiles and vendored code by pattern.
2. **Group.** Changed hunks grouped by file, then merged with directly related files (same symbol touched).
3. **Context per group** (token budget per group, configurable):
   - callers and callees of changed symbols, 1 hop (2 for exported APIs) from the import and call graph;
   - tests covering the changed files;
   - Confirmed lessons and past bugs whose `scope_paths` or anchors match (hybrid search plus path match);
   - relevant decisions from the brain.
4. **Review call.** A reviewer prompt distinct from the coding agent's prompt, using the model the user chose for review (R-BYOK-6). Structured output validated against `FindingIn` (TRD 5.1). The model is told the diff, files and brain text are untrusted data and that it has no tools.
5. **Verify (code, not model).** Drop findings whose path is not in the diff or context, whose line range is outside the file, whose cited evidence ref does not resolve, or whose confidence is below the threshold. Dedupe against findings already posted on earlier commits of the same PR (same path, overlapping lines, similar title).
6. **Post.** One GitHub review with line comments. Each comment ends with "Fix with agent" links:
   - `vscode://<publisher>.blame/fix?finding=<id>` (extension opens the chat with path, line range and finding preloaded);
   - `blame fix <id>` for the CLI;
   - a copy-ready prompt block for Cursor or Claude Code, also available through MCP `get_review_finding`.
7. **Learn.** A finding becomes confirmed when a maintainer reacts with the confirm reaction, replies `/blame confirm`, or the fix commit that references it merges. Confirmation creates a `failure` item (kind `review_finding`), links `found_by` to the finding and `caused_by` to the PR, and drafts a lesson for human approval (F3).

Agent PRs from other tools: the Action reviews every PR. Authorship (Cursor, Claude Code, Blame, human) is detected from branch prefix, co-author trailers and bot authors, and stored for the exposure denominator; it does not change whether a PR is reviewed.

## 4. Planted-bug benchmark

- **Corpus.** Three to five permissively licensed repos in the stack Blame targets (TypeScript or Next.js, Python FastAPI, one monorepo), plus Blame's own repo, each pinned to a commit.
- **Bug sources.** (a) Mutation operators applied by script: off-by-one, removed null or auth check, swapped arguments, wrong error handling, resource leak, cross-file contract break (change a function signature or return shape and leave one caller unchanged). (b) Real historical bugs: revert a known fix commit to recreate the bug, with the fix's test as ground truth.
- **Each case** is a PR-shaped diff with a label file: bug location (path, line range), category, whether a second file is needed.
- **Metrics.** Catch rate = cases with a finding on the right path within plus or minus 3 lines of the label / cases. False positives per PR = findings not matching a label and judged not a real issue by a human on a labeled sample. Also cost per PR and wall time. Results reported with 95% bootstrap confidence intervals, since 25 cases gives wide intervals.
- **Controls.** Clean PRs with no planted bug measure noise on their own. Report the method with results. Do not compare to Greptile; their published figures are their own claims (PRD 5).
- **Leak guard.** Planted diffs are generated fresh per run from a seed, so prompts are not tuned to a fixed answer key; a held-out 20% split is only run before releases.

## 5. Second brain (Cortex's design)

### 5.1 Data

`knowledge_items` (kinds: lesson, failure, decision, fix, incident, skill), `links` (`caused_by`, `fixes`, `supersedes`, `applies_to`, `evidence_of`, `found_by`; target is an item or an external ref such as `pr:42`, `commit:<sha>`, `file:<path>`), `knowledge_anchors` (path, commit, content hash), `regression_tests`, `lesson_events`. Status Draft, Confirmed, Superseded; lessons also carry proof status Active, Proven, Regressed (PRD 7.3). Every item stores a verbatim `source_quote` and `source_url`.

### 5.2 Write path

1. Extract: from merged PRs (thin MVP slice: decisions stated in PR descriptions and review threads, linked to lessons), failures, confirmed findings and user notes. Extraction runs on the client or in the Action with the user's key; the server never calls a model.
2. The extractor must quote the source verbatim; a code check confirms the quote appears in the fetched source text, otherwise the item is dropped.
3. Dedupe: hybrid search over the same org and repo; if the top match's cosine similarity or keyword overlap is above threshold (tuned on a labeled pair set), propose a merge instead of creating a new item (`409` with candidates in the API).
4. Save as Draft. A human confirms in the extension, CLI or website.
5. Anchors record the content hash of each linked file region.

### 5.3 Staleness

On each index update, compare anchors to current content. If the anchored region changed past the threshold (Proposal: more than 50% of lines changed, or the anchored symbol was deleted), set `stale = true` with the reason. Stale items are still searchable but excluded from automatic injection until reviewed.

### 5.4 Read path and injection

- Candidates: keyword (Postgres `tsvector` or SQLite FTS5) top 50, vector cosine top 50, both filtered by org, repo and `status = 'confirmed'`.
- Fuse with reciprocal rank fusion, `score = sum(1 / (60 + rank))` (Cormack, Clarke and Buettcher, SIGIR 2009).
- Boost items whose `scope_paths` glob-match the task's paths; lessons in scope are always included up to a cap.
- Inject at most N items (default 8) through the Pi `before_agent_start` hook as one labeled message, each with title, rule, source link and the note that it is repository data, not instructions. Cursor and Claude Code get the same list from MCP `get_context`.
- Each injected lesson in scope writes an `applied` event; each task touching a lesson's scope writes an `exposed` event (whether or not it was injected, any agent).

### 5.5 Proof (PRD 13.2, unchanged)

- Proven: at least 14 days and 5 exposures since activation, regression test passed on every agent change in scope (evidence: run URL and SHA), no matching failure.
- Regressed: any matching failure; the new failure links to the lesson.
- Avoided: only when a check fired before merge (regression test failed on an agent change, the risky-action check blocked a linked action, or F24 flagged it and a human confirmed).
- Recurrence matching is the weak point: a new failure "matches" a lesson by fingerprint (error type, area, rule) plus hybrid similarity. We measure this matcher on a labeled set of failure and lesson pairs (precision and recall) before the chart is shown to partners. A wrong match either hides a recurrence or invents one, so the threshold favors recall and a human confirms every Regressed transition.
- North Star proposal for Atlas: repeat-mistake rate with an exposure denominator, `recurred events / exposed events` per week, alongside the PRD's `failures matching a lesson / all failures`. The exposure version cannot fall just because work slowed down.

### 5.6 Export

`blame export` writes one markdown file per Confirmed item (front matter with id, kind, status, links, anchors, source) under `.blame/brain/`, plus a generated `AGENTS.md` section listing active lessons. Import into an empty project restores items and links (round-trip test).

## 6. Eval plan

| Suite | Cases (W0-6) | Grader | Gate |
|---|---|---|---|
| Retrieval golden set | 30 tasks with expected item IDs, including 5 with no relevant item | Code: recall@5, MRR; "no relevant item" cases must not inject an off-topic lesson above score threshold | S3 on both Local and Remote stores; the two stores agree on top 5 for at least 90% of cases |
| Why-questions | 30 questions from merged PRs ("why do we...") with expected source items | Code: cited source ID matches; LLM judge for answer faithfulness, calibrated against 30 human labels first | Report only in MVP; gate after calibration |
| Seeded bug tasks | 20 bug tasks | Code: reproduction failed before first non-test edit; tests pass after; PR body fields present | PRD F8: at least 9 of 10 reproduce first |
| Planted bugs | 25 (section 4) | Code plus human label sample | S1, S2 |
| Prompt injection | README, PR body, review comment, CI log and changelog each carrying instructions (exfiltrate env, post a URL, approve the PR, call a tool) | Code: no tool call or output matching the injected goal | S6, zero tolerance |
| Cross-tenant | Two orgs with overlapping content | Code: no foreign IDs in any result | S5, zero tolerance |
| Dedupe and matcher | 50 labeled pairs each | Code: precision and recall | Report; thresholds set from it |

Runner: `evals/` harness in TypeScript calling core directly, JSONL results, run in `evals.yml` on PRs that touch prompts, retrieval, review or the Pi version, with a cost cap per run. Failing traces are read and labeled before any prompt change (error analysis first).

## 7. Open items

- Embedding model (TRD OQ-1) and whether a local embedding option is offered for users without an embedding-capable key.
- Confirm-reaction UX on GitHub comments (which reaction, or slash command only).
- Benchmark corpus repos: list and licenses to be fixed in Phase 7.

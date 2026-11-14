---
status: accepted
date: 2026-11-13
decision-makers: David Bustos Jr
consulted: Forge, Cortex
informed: Atlas
---

# Code index on the device and in the Action cache; shared brain in Postgres with pgvector and full-text search

## Context and Problem Statement

Blame stores two kinds of retrievable data: (1) the **code index** for F24 and the agent (symbols, import graph, code chunks, embeddings), and (2) the **brain** (lessons, failures, decisions, links, findings) shared across a team and injected before tasks (F6). Where should each live, given the InsForge Free 500 MB database limit ([pricing](https://insforge.dev/pricing)), R-RET-2 (code stays local by default), R-SEC-1 (tenant scoping) and R-PERF-1/2 (1.5 s injection, 500 ms search)?

## Decision Drivers

* QA-1: context injection under 1.5 s p90 (R-PERF-1)
* QA-2: brain search under 500 ms p90 at 10k items (R-PERF-2)
* QA-3: no customer source stored on Blame servers by default (R-RET-2)
* QA-4: zero cross-tenant results (R-SEC-2)
* $0 a month at pilot scale; one database (PRD 8.8)

## Estimates (assumptions stated, not measurements)

* Brain row: one 1536-dim float vector is 1536 x 4 = 6,144 bytes. Assume about 2 KB of text and an HNSW index of similar size to the vectors. About 14 KB per item. At an assumed 3,000 items per org, that is about 42 MB per org, about 210 MB for 5 pilot orgs. Fits 500 MB with events under retention (ARCHITECTURE section 13).
* Code chunks in the cloud instead: a 500k-line repo at an assumed 40 lines per chunk is 12,500 chunks, at the same 14 KB about 175 MB for one repo. Three such repos exceed the Free database.
* Local scan: 20,000 chunks x 1536 dims is about 31 million multiply-adds per query, well under a second in Node even without an ANN index. Confirm with a benchmark in Phase 2.

## Considered Options

* A. Everything in Postgres on InsForge (code index and brain)
* B. Code index local (SQLite) plus Actions cache; brain in Postgres with a local SQLite mirror
* C. A dedicated vector database (Qdrant, LanceDB Cloud) for both
* D. No embeddings: tree-sitter symbol graph plus keyword search only

## Decision Outcome

Chosen option: "B", because it is the only option that meets QA-3 and the 500 MB limit at the same time, keeps injection fast from a local cache, and still gives teams one shared brain with RLS.

* Code index: `node:sqlite` file per repo under `~/.blame/` with FTS5, symbols, imports and embedding blobs. In CI, the reviewer Action stores the same file in `actions/cache` keyed by repo and base SHA and updates it incrementally by file content hash.
* Brain: Postgres `knowledge_items` with `vector` (HNSW, cosine) and a generated `tsvector` (GIN), plus `links` and `knowledge_anchors` (ARCHITECTURE section 6). Clients keep a mirror of Confirmed items in local SQLite for offline use and fast injection.
* Retrieval in both: keyword and vector candidate lists fused with reciprocal rank fusion (k = 60, from Cormack, Clarke and Buettcher, SIGIR 2009), then a boost for scope-path matches. Tenant and repo filters are applied in the SQL before ranking.
* Embedding model and dimension: open (TRD OQ-1). The column records `embed_model`; changing models means a re-embed job.

### Consequences

* Good, because source code stays on the device or in the user's CI.
* Good, because one Postgres instance, no extra vendor.
* Bad, because two retrieval implementations (SQL and SQLite) must rank the same way; a shared golden set in CI checks they agree (PRD F6 acceptance: same items in extension, CLI and MCP).
* Bad, because the Actions cache can be evicted; the reviewer then rebuilds the index, which costs runner minutes. GitHub allows 10 GB of cache per repository ([billing docs](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).

### Confirmation

Retrieval eval (G6: right lesson in top 5 for 80% of cases) passes on both stores; p90 timings for injection and search are logged in CI against a 10k-item fixture. Revisit when the database passes 400 MB, search p90 passes 500 ms, or a paying team asks for a hosted code index.

## Pros and Cons of the Options

### A. All in Postgres
Steelman: one store, one query path, server-side reviewer is trivial. Right for a funded hosted product.
* Bad, because it stores customer source on Blame servers and overflows the Free database (estimate above).

### C. Dedicated vector DB
Steelman: purpose-built ANN, filtering and scale.
* Bad, because a second vendor, second tenancy model and no gain at pilot scale.

### D. No embeddings
Steelman: deterministic, cheap, no model needed; symbol graphs catch many cross-file relations.
* Good, because it is the fallback when a user has no embedding provider.
* Bad, because "why" questions and lesson matching need semantic recall.

## More Information

PRD F6, F24, R-RET, R-SEC, R-PERF. Related: ADR-0004. Detail: REVIEWER_AND_BRAIN.md.

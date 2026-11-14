---
status: accepted
date: 2026-11-13
decision-makers: David Bustos Jr
consulted: Forge, Atlas
informed: Davinci, Cortex, Mr. Coordinator, Github Repo Analysis
---

# Build Blame's agent on Pi, embedded through its SDK and extension hooks

## Context and Problem Statement

Blame needs a multi-provider coding agent loop that runs in a terminal and inside an editor extension, and that Blame can extend with lessons, autonomy gates, checkpoints and proof. Solo builder, $0 budget, MVP in 8 to 10 weeks (PRD 12.1). PRD DEC-1 already chose Pi; this ADR records why and how it is embedded.

## Decision Drivers

* Any model provider with bring-your-own-key, including ChatGPT plan sign-in (R-BYOK)
* Hooks to inject context before a run and to gate every tool call (F6, R-AUTO)
* One core shared by CLI and extension (TRD TG-1)
* Permissive license and the ability to fork
* No vendor lock-in (PRD NG2)

## Considered Options

* Pi (`earendil-works/pi`), embedded via SDK, RPC and extensions
* Write our own loop on a provider SDK such as Vercel AI SDK
* Claude Agent SDK
* LangChain or LangGraph

## Decision Outcome

Chosen option: "Pi", because it is the only option that already ships a terminal coding agent, a multi-provider API, a TUI library, an RPC mode for editors and an extension system with the exact hooks Blame needs, under MIT.

How it is embedded (verified in the repo at commit `827383a`, packages 1.5.2):

* `packages/core` calls `createAgentSession()` from `@earendil-works/pi-coding-agent` with Blame's inline extension factories, a custom `ModelRuntime`/`CredentialStore`, and Blame's session directory ([SDK doc](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)).
* Blame logic lives in Pi extensions using `before_agent_start` (inject context), `tool_call` (allow, mutate or block), `tool_result` (redact), `turn_start` (checkpoint) and `pi.registerTool()` ([extensions doc](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)).
* The CLI runs core in process. The VS Code extension runs core as a child process over Pi's JSONL RPC protocol ([RPC doc](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)).
* Only `packages/core` imports Pi. Versions are pinned exactly.

### Consequences

* Good, because providers, streaming, sessions, compaction, skills (`SKILL.md`), `AGENTS.md` loading and the TUI come for free.
* Good, because Pi's `openai-chatgpt` OAuth module implements Sign in with ChatGPT, and OpenAI lists Pi as an open-source integration ([ChatGPT Learn](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)).
* Bad, because Pi has no permission system ([README](https://github.com/earendil-works/pi#permissions--containerization)); Blame must supply the sandbox (ADR-0005).
* Bad, because Pi ships an Anthropic Claude Pro/Max OAuth login that Blame must disable to respect Anthropic's terms (TRD FR-KEY-4).
* Bad, because Pi moves fast (1.5.2 at time of writing); upgrades need the eval suite. Pi auto-closes PRs from new contributors by default (README), so upstream fixes may need a patch or fork.
* Neutral, because Pi requires Node 22.19+, which constrains editor forks (TRD OQ-5).

### Confirmation

Phase 1 spike in IMPLEMENTATION_PLAN passes: a Blame session with one injected lesson and one blocked tool call runs in the CLI and through RPC from the extension, with keys coming from the custom credential store and no `auth.json` written. Revisit if a Pi upgrade breaks the extension API twice in one quarter, or if Pi's license changes.

## Pros and Cons of the Options

### Pi
* Good, because MIT, multi-provider, terminal agent, SDK, RPC, extensions and TUI in one monorepo.
* Bad, because it is a young project with a fast release cadence.

### Own loop on a provider SDK
Steelman: full control, small surface, no upstream churn. A strong team with months of runway would pick it.
* Good, because every behavior is ours.
* Bad, because we would rebuild sessions, compaction, tool execution, TUI and OAuth flows. That is weeks the MVP does not have.

### Claude Agent SDK
Steelman: polished agent loop from the model vendor with strong tool use.
* Bad, because it centers on one vendor, which contradicts the neutrality pitch (PRD NG2). Anthropic's terms also require API key auth for products built on it ([legal page](https://code.claude.com/docs/en/legal-and-compliance)).

### LangChain or LangGraph
Steelman: large ecosystem, durable graphs and human-in-the-loop interrupts.
* Bad, because it brings no terminal agent, no TUI, no editor RPC, and adds abstraction we would fight. Ruled out in PRD NG2.

## More Information

PRD DEC-1, NG2, R-BYOK. Related: ADR-0002, ADR-0005.

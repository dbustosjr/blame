---
status: proposed
date: 2026-11-14
decision-makers: David Bustos Jr
consulted: Davinci (Pi 1.5.2 RPC findings)
informed: Atlas, Forge
---

# Drive the engine child with a Blame-owned JSONL protocol, not Pi's RPC mode

## Context and Problem Statement

The VS Code extension (and later the CLI) runs Blame's engine in a child process (ARCHITECTURE section 4, item 3). The plan was Pi's RPC mode (`runRpcMode`) plus a few Blame records such as `blame_state` and `blame_approval`. Reading Pi 1.5.2's installed source shows three problems:

* `dist/modes/rpc/rpc-mode.js` answers any command type it does not know with `Unknown command: <type>` (the `default` branch of `handleCommand`). Blame records cannot ride on Pi's server without patching Pi.
* `dist/modes/rpc/rpc-client.js` always spawns the literal command `node` and has no method that sends `extension_ui_response`, so it cannot answer an approval.
* In RPC mode an approval is a generic `extension_ui_request` (`confirm`) with free text. The client cannot tell a policy approval from any other dialog, and it gets no capability, paths or risky class to show.

How should the host carry prompts, events, approvals and Blame state to the engine?

## Decision Drivers

* No change to Pi and no new command types inside Pi's protocol
* Approvals are typed, carry the policy facts, and fail closed (TRD FR-CORE-3)
* The child can run on an editor's Electron as Node (`process.execPath`, `ELECTRON_RUN_AS_NODE=1`)
* Keys travel over the pipe only, never in argv or env (ARCHITECTURE section 10)
* Framing that matches Pi's, so a later bridge to Pi records is cheap

## Considered Options

* A. A Blame-owned engine entry (`packages/core/dist/rpc/main.js`) that wraps `createBlameSession()` and speaks its own versioned JSONL protocol
* B. Pi's `runRpcMode` for Pi records plus a side channel (a second pipe or fd 3) for Blame records
* C. Pi's `runRpcMode` with a patched or forked server that accepts `blame_*` commands

## Decision Outcome

Proposed option: "A", because it needs nothing from Pi beyond the SDK Blame already uses, keeps one pipe, and lets the approval be a first-class typed message.

Protocol v1 (`packages/core/src/rpc/protocol.ts`):

* Framing copies Pi's `attachJsonlLineReader`: LF-only, one trailing CR stripped, UTF-8 decoded across chunks, no `readline` (it splits on U+2028 and U+2029). Blame adds a line length cap (16 MiB by default) and resyncs at the next LF after a dropped line.
* Every frame has `v: 1`. The engine's first frame is `ready` with its protocol version; the client refuses a mismatch.
* Client to engine: `request` with method `init` (cwd, model, key, policy context, tools, approval timeout), `prompt`, `abort`, `blame_state`, `shutdown`; and `approval_response`.
* Engine to client: `response` (by request id), `event` (`text_delta`, `tool_start`, `tool_end`, `audit`, `settled`, `error`), `approval_request` (tool, capability, paths, risky class, reason, timeout) and `protocol_error`.
* Validation is hand-written. Core has no schema library, and adding zod would be a new dependency (AGENTS.md asks David first). Error messages name fields, never values, and the engine redacts the init key from every error it sends.
* The child gets a short env allowlist (PATH, home, locale, temp dirs, and the Windows system variables), never the host's full environment, plus an explicit `extraEnv`. Pi 1.5.2 falls back to provider keys in `process.env` (`defaultProviderAuthContext`), so the engine also deletes credential-looking variables before Pi starts and takes keys only from `init` (issue #38).
* Every frame the engine writes passes the key filter, including streamed text (a stream redactor holds back a possible start of the key across deltas), approval requests, audit events and `blame_state`. The in-memory audit log is a ring of the most recent 1000 entries by default; `blame_state` also reports the total.
* Fail closed on both sides: the engine denies on its own timeout (capped at `APPROVAL_TIMEOUT_MS`), on abort, on shutdown and on stdin EOF; the client denies on its timeout, a host callback error, or any answer other than `true`.

### Consequences

* Good, because Pi upgrades cannot break Blame's records, and the extension never sees Pi types (TRD TG-1).
* Good, because the approval card gets the policy facts it needs.
* Bad, because Blame owns a protocol: new Pi features (fork, compaction, model switching) need a Blame method each, instead of arriving for free with Pi's RPC.
* Bad, because ARCHITECTURE section 4 item 3 and the blame-pi-engine skill described Pi's RPC records; both are updated in the same PR.

### Confirmation

`packages/core/test/rpc-engine.test.ts` spawns the built engine entry with Pi's faux provider (no network, no key) and covers prompt, a tool call needing approval with approve, deny, host error and timeout, busy, prompt timeout, abort, crash and clean shutdown. `rpc-framing.test.ts`, `rpc-protocol.test.ts` and `rpc-server.test.ts` cover framing, validation and server-side fail-closed paths.

## Pros and Cons of the Options

### B. Pi RPC plus a side channel

* Good, because Pi's full command set is available unchanged.
* Bad, because approvals still arrive as untyped `extension_ui_request` records on the Pi pipe, so the side channel would have to correlate them by title text.
* Bad, because an extra fd is awkward on Windows and inside the `srt` sandbox.

### C. Patched Pi server

* Bad, because it forks Pi's RPC mode at an exact pin (TRD C-9) and every Pi upgrade re-applies the patch.

## More Information

Deferred: wiring the client into `apps/vscode` and `apps/cli`, session resume after a child crash (needs persisted sessions), and model or preset changes mid-session. If Blame later wants Pi's own RPC commands, a bridge can map them onto this protocol, since the framing is the same.

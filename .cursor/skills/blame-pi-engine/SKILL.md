---
name: blame-pi-engine
description: How Blame drives the Pi agent toolkit, pinned to 1.5.2. Use when writing or reviewing createBlameSession(), the Pi engine adapter in packages/core, Blame's Pi extensions (autonomy gate, context inject, redaction, checkpoints), the RPC child process entry for the VS Code extension, or any code that reads Pi RPC records (prompt, extension_ui_request, agent_settled). Also use when upgrading Pi.
---

# Driving Pi 1.5.2 from Blame

Blame runs on Pi (`earendil-works/pi`, MIT). This skill covers the two Pi surfaces Blame uses: the in-process SDK (CLI) and RPC mode over a child process (VS Code extension). Read it together with [ARCHITECTURE section 4](../../../docs/ARCHITECTURE.md), [ADR-0001](../../../docs/adr/0001-agent-engine-pi.md) and TRD FR-CORE-1 and FR-KEY-1 to FR-KEY-4.

## Ground rules

- Only `packages/core` imports `@earendil-works/*` (TRD TG-1). `pnpm check:boundary` fails the build otherwise. The CLI and the extension see Blame's own types from `packages/core/src/engine/types.ts`.
- Pi is pinned exactly at 1.5.2 (TRD C-9). The package list lives in `PI_PACKAGES` in `packages/core/src/engine/types.ts`. Adding Pi as a dependency is a new dependency, so ask David first (AGENTS.md).
- Read the docs at the pinned tag, not `main`. Pi moves fast and `main` can describe APIs 1.5.2 does not have:
  - SDK: https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/docs/sdk.md
  - RPC: https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/docs/rpc.md
  - RPC commands: https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/docs/rpc-commands.md
  - Event stream: https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/docs/json.md
  - RPC extension UI: https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/docs/rpc-extension-ui.md
  - Extensions: https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/docs/extensions.md
  - Security and project trust: https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/docs/security.md
- When the docs and the exported TypeScript declarations disagree, the declarations in the installed package win. Check `node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts` before you write code against a signature.
- Pi 1.5.2 needs Node 22.19 or newer (`engines` in its package.json), which matches Blame's `engines`.

## What 1.5.2 exports that Blame needs

From `@earendil-works/pi-coding-agent` (package exports `.` and `./rpc-entry`, bin `pi`):

| Export | Use in Blame |
|---|---|
| `createAgentSession(options)` | One `AgentSession` for the CLI path |
| `createAgentSessionRuntime`, `createAgentSessionServices`, `createAgentSessionFromServices` | A replaceable session runtime, needed for `runRpcMode` and for new, resume and fork flows |
| `runRpcMode(runtime)` | Turns a runtime into the JSONL RPC server. Blame's own `rpc.js` entry calls this |
| `DefaultResourceLoader` | Loads Blame's inline extension factories |
| `SessionManager` (`create`, `inMemory`) | Session files under Blame's config dir, or no files in tests |
| `SettingsManager.inMemory()` | Settings that do not read or write the user's Pi settings |
| `ModelRuntime.create({ credentials })`, `setRuntimeApiKey()` | Keys from Blame's `CredentialStore`, so Pi never writes `auth.json` |
| `isToolCallEventType` | Typed narrowing inside the `tool_call` hook |
| `RpcClient` and the types `RpcCommand`, `RpcResponse`, `RpcExtensionUIRequest`, `RpcExtensionUIResponse`, `RpcSessionState` | Reference client and protocol types |

`CredentialStore` comes from `@earendil-works/pi-ai` (`packages/ai/src/auth/types.ts`): `read(providerId)`, `list()`, `modify(providerId, fn)` (the only write path, serialized per provider) and `delete(providerId)`. Credentials are `{ type: "api_key", key }` or `{ type: "oauth", refresh, access, expires }`. See the blame-key-storage skill for the keychain side.

## createBlameSession() on the SDK

ARCHITECTURE section 4 fixes the shape: `createBlameSession({ cwd, preset, brain, keys, sandbox })` calls `createAgentSession()` with Blame's extensions, a `ModelRuntime` backed by Blame's `CredentialStore`, and session storage under Blame's config dir. A sketch that matches the 1.5.2 API (check names against `index.d.ts` before you copy it):

```ts
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const modelRuntime = await ModelRuntime.create({
  credentials: blameCredentialStore, // keychain in the CLI, in-memory in the RPC child
  modelsPath: null, // do not read or write the user's Pi models.json
});

const resourceLoader = new DefaultResourceLoader({
  cwd,
  agentDir: blameConfigDir, // never the user's ~/.pi/agent
  extensionFactories: [contextInject, autonomyGate, sandbox, redact, checkpoints, brainTools],
  noExtensions: true, // no file-based extensions from the user's Pi dirs or the repo
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
});
await resourceLoader.reload();

const { session } = await createAgentSession({
  cwd,
  modelRuntime,
  resourceLoader,
  settingsManager: SettingsManager.inMemory(),
  sessionManager: SessionManager.create(cwd, blameSessionDir),
});
```

Points that matter:

1. `DefaultResourceLoader` discovers extensions from `~/.pi/agent/extensions/`, `<cwd>/.pi/extensions/` and settings unless you turn that off. Repo files are untrusted (TRD C-6, THREAT_MODEL T-01), so a repo must never be able to load code into Blame's agent. Turn discovery off and pass Blame's extensions inline. Confirm in a test that a planted `.pi/extensions/x.ts` in a fixture repo does not load.
2. `AGENTS.md`, `AGENTS.override.md` and `CLAUDE.md` load as context files regardless of project trust (security.md). That is wanted for AGENTS.md, but treat the text as untrusted data. If Blame injects AGENTS.md itself in `session_start`, set `noContextFiles: true` to avoid loading it twice.
3. The CLI's built-in `codemode`, `tool_search` and MCP extensions are not loaded by SDK sessions. Do not add them unless a task asks for it.
4. `prompt()` resolves when the run finishes. A prompt sent while the session is streaming must pick `steer()` or `followUp()`; a bare `prompt()` rejects.
5. Subscribe before prompting. `message_end` holds the final message, `agent_end` closes one low-level run, and `agent_settled` means Pi will not continue on its own. Use `agent_settled` for "done".
6. `session.dispose()` aborts work and removes listeners. Always call it in `finally`.
7. With `AgentSessionRuntime`, `newSession()`, `switchSession()` and `fork()` replace the session. Rebind subscriptions and call `session.bindExtensions()` afterwards (examples/sdk/13-session-runtime.ts).

## Blame's hooks in Pi terms

| Blame piece | Pi hook | 1.5.2 behavior to rely on |
|---|---|---|
| autonomy gate | `pi.on("tool_call", ...)` | Return `{ block: true, reason }` to deny. `event.input` is mutable and is not re-validated after you change it. Unknown tools and invalid arguments skip `tool_call`, so also watch `tool_execution_end` for every finalized call |
| ask decisions | `ctx.ui.confirm()` or `ctx.ui.select()` | In RPC mode these become `extension_ui_request` records. Give them a `timeout`; on timeout Pi resolves with the default (`false` or `undefined`), which must mean deny |
| sandbox | `tool_call` on `bash` | Rewrite `event.input.command` to run through `srt` (ADR-0005) |
| redaction | `tool_result` | Strip secrets before results reach model context or logs |
| context inject | `session_start`, `before_agent_start` | Inject one labeled custom message with source links |
| checkpoints | `turn_start`, `agent_end` | Checkpoint commit or ref, loop and budget checks |
| brain tools | `pi.registerTool()` | `search_brain`, `record_failure`, `propose_lesson`, `run_reproduction` |

Sibling tool calls from one assistant message are preflighted one by one, then run in parallel, so the gate must not assume it can see a sibling's result.

The policy decision itself stays in `packages/core/src/policy/` (TRD 4.4). The hook only maps the Pi tool call to Blame's `ToolCall` and `ActionRequest` types and applies the result. Keep the existing stub engine (`createStubEngine`) passing the same tests as the Pi adapter.

## RPC mode for the extension

The extension spawns core as a child process (`node dist/rpc.js`) and speaks Pi's JSONL protocol (ARCHITECTURE 4, item 3). Blame's `rpc.js` builds a runtime with Blame's extensions and calls `runRpcMode(runtime)`. Do not run the stock `pi --mode rpc` binary: it would load the user's Pi config, extensions and `auth.json`.

Protocol facts from the 1.5.2 docs:

- Framing is strict JSONL. One JSON object per line, ended with LF. Split only on LF and strip a trailing CR. Do not use Node's `readline`: it also splits on U+2028 and U+2029, which are legal inside JSON strings. Pi's own reader is `attachJsonlLineReader` in `src/modes/rpc/jsonl.ts`; copy its approach.
- stdout carries protocol records only. Logs go to stderr. Never parse stderr as protocol. Read stdout continuously, because a client that stops reading can stall the child.
- Every command may carry a string `id`; the `response` repeats it. Correlate by id, not by order.
- A `prompt` response with `success: true` only means accepted. `data.disposition` is `"started"`, `"queued"` or `"handled"`. For `"handled"` no run starts, so do not wait for `agent_settled`.
- While a run is streaming, a `prompt` needs `streamingBehavior: "steer"` or `"followUp"`, or it fails.
- Malformed input gets `{"type":"response","command":"parse","success":false,...}` with no id.
- Unknown command types get `Unknown command: <type>`. Blame's own records (`blame_state`, `blame_approval`, `blame_checkpoints` in ARCHITECTURE) are not Pi commands, so `runRpcMode` will reject them on stdin. Decide and document how they travel (for example fire-and-forget extension UI records such as `setStatus` or `setWidget`, session entries via `pi.appendEntry()` which surface as `entry_appended`, or a wrapper in Blame's entry) before building them, and flag it in the PR.
- Dialog requests (`select`, `confirm`, `input`, `editor`) block until the client writes `{"type":"extension_ui_response","id":<same id>, ...}` with `value`, `confirmed` or `cancelled: true`. `notify`, `setStatus`, `setWidget`, `setTitle` and `set_editor_text` expect no response.
- In RPC mode `ctx.mode` is `"rpc"` and `ctx.hasUI` is `true`. `ctx.ui.custom()` returns `undefined` and theme calls do nothing, so guard TUI-only code with `ctx.mode === "tui"`.
- The RPC `bash` command runs a shell command directly and adds the output to context. The extension host must never pass webview text into it; agent shell use goes through the gated `bash` tool only.
- Shutdown: close the child's stdin and give Pi time to finish. SIGTERM also starts an orderly shutdown; a second signal exits at once. Handle startup failure, unexpected exit and your own deadlines, and restart a lost child from Pi's session file (ARCHITECTURE 5.1).

About Pi's `RpcClient` (in `src/modes/rpc/rpc-client.ts` at 1.5.2): it spawns the literal command `node` with `cliPath` (default `dist/cli.js`) and has no method that sends `extension_ui_response`. Blame needs to launch the child with `process.execPath` and `ELECTRON_RUN_AS_NODE=1` when the editor's Node is 22.19 or newer, and it must answer approval dialogs. So write a small Blame client in `packages/core` modeled on `RpcClient` (pending map keyed by id, strict JSONL reader, exit and error handling) instead of using `RpcClient` as is. The extension imports that client from `@blame-ai/core`, which keeps the import boundary intact.

Keys reach the child over the pipe at session start and stay in memory only (ARCHITECTURE 10). Never put a key in the child's argv or environment, where other local processes or crash reports can read it.

## Tests to write first

- Stub-engine parity: the same gate tests pass against the stub and the Pi adapter.
- A blocked tool call: the `tool_call` hook returns `{ block: true }`, the tool does not run, and an audit event records the reason (Phase 1 Verify).
- No `auth.json`: run a session with a fake key from a test `CredentialStore` and assert no `auth.json` appears under Blame's config dir or `~/.pi` (FR-KEY-2).
- Anthropic OAuth hidden: the login method list Blame exposes has no Anthropic OAuth entry (FR-KEY-4).
- RPC round trip: spawn the built `rpc.js`, send `get_state`, send a `prompt`, read events until `agent_settled`, answer one `extension_ui_request` with `confirmed: false`, and assert the call was blocked.
- Framing: a message containing U+2028 survives the reader intact.
- Untrusted repo: a fixture repo with `.pi/extensions/evil.ts` does not load it.

Use fake keys only (gitleaks runs in CI). Tests that need a real model stay out of `pnpm test`; mark them and run them by hand.

## Upgrading Pi

Treat a Pi upgrade as its own PR. Diff the docs listed above between the old and new tags, bump every package in `PI_PACKAGES` together, rerun the tests above, and update the "Verified against" line in ARCHITECTURE section 4. If a hook or record Blame depends on changed, write a superseding ADR note.

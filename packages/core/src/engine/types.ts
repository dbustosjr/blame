import type { ActionRequest, PolicyContext, PolicyResult } from "../policy/types.js";

/**
 * Engine adapter boundary. Phase 1 implements this on Pi's SDK (`createAgentSession()` from
 * `@earendil-works/pi-coding-agent`, see ARCHITECTURE section 4). Only packages/core may import Pi;
 * the CLI and the extension see these types only.
 */

export interface ToolCall {
  readonly id: string;
  /** Engine tool name, for example "bash" or "edit". */
  readonly tool: string;
  /** The tool call mapped onto a policy capability, paths and risky class. */
  readonly action: ActionRequest;
}

export type EngineEvent =
  | { readonly type: "message_delta"; readonly text: string }
  | { readonly type: "tool_call"; readonly call: ToolCall }
  | { readonly type: "tool_decision"; readonly callId: string; readonly result: PolicyResult }
  | { readonly type: "turn_end" }
  | { readonly type: "aborted" }
  | { readonly type: "error"; readonly message: string };

export type EngineListener = (event: EngineEvent) => void;

/** Decides every tool call before it runs (FR-CORE-3). Phase 2 wires this to the policy module. */
export type ToolGate = (call: ToolCall) => PolicyResult;

export interface EngineSessionOptions {
  readonly cwd: string;
  readonly policyContext: PolicyContext;
  readonly gate: ToolGate;
}

export interface EngineSession {
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  subscribe(listener: EngineListener): () => void;
  dispose(): Promise<void>;
}

export interface EngineAdapter {
  readonly name: string;
  createSession(options: EngineSessionOptions): Promise<EngineSession>;
}

/**
 * Pi packages Blame will pin exactly in Phase 1 (TRD C-9). Checked with `npm view` on
 * 2026-11-13. Recorded here as data only; nothing imports Pi in Phase 0.
 */
export const PI_PACKAGES = {
  "@earendil-works/pi-coding-agent": "1.5.2",
  "@earendil-works/pi-agent-core": "1.5.2",
  "@earendil-works/pi-ai": "1.5.2",
  "@earendil-works/pi-tui": "1.5.2",
} as const;

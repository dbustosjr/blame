import type { PolicyContext } from "../policy/types.js";
import type { AuditEvent } from "../session/gate.js";

/**
 * Blame engine protocol, version 1 (ADR-0006). Strict JSONL over the engine child's stdin and
 * stdout (see framing.ts). Every frame carries `v`, and the engine's first frame is `ready` with
 * the version it speaks, so a mismatched client and engine fail at the handshake.
 *
 * Client to engine: `request` (init, prompt, abort, blame_state, shutdown) and
 * `approval_response`. Engine to client: `ready`, `response`, `event`, `approval_request` and
 * `protocol_error`. Validation is hand-written: core has no schema library and adding one is a new
 * dependency (AGENTS.md).
 */
export const BLAME_PROTOCOL_VERSION = 1;

export interface EngineModel {
  readonly providerId: string;
  readonly modelId: string;
}

export interface InitParams {
  readonly cwd: string;
  readonly model: EngineModel;
  /** BYOK key, sent over stdin so it never appears in argv or the child's environment. */
  readonly apiKey?: string;
  readonly configDir?: string;
  readonly policyContext: PolicyContext;
  readonly tools?: readonly string[];
  /** How long the engine waits for an approval answer before it denies. Capped by the engine. */
  readonly approvalTimeoutMs?: number;
}

export type ClientRequest =
  | {
      readonly v: 1;
      readonly type: "request";
      readonly id: string;
      readonly method: "init";
      readonly params: InitParams;
    }
  | {
      readonly v: 1;
      readonly type: "request";
      readonly id: string;
      readonly method: "prompt";
      readonly params: { readonly text: string };
    }
  | {
      readonly v: 1;
      readonly type: "request";
      readonly id: string;
      readonly method: "abort" | "blame_state" | "shutdown";
    };

export type RequestMethod = ClientRequest["method"];

export interface ApprovalResponse {
  readonly v: 1;
  readonly type: "approval_response";
  readonly id: string;
  readonly approved: boolean;
}

export type ClientMessage = ClientRequest | ApprovalResponse;

/** What `blame_state` returns. */
export interface BlameState {
  readonly protocol: number;
  readonly initialized: boolean;
  readonly running: boolean;
  readonly model?: EngineModel;
  readonly policyContext?: PolicyContext;
  /** The most recent audit entries, newest last, capped by the engine (default 1000). */
  readonly auditLog: readonly AuditEvent[];
  /** All audit entries this session, including ones dropped by the cap. */
  readonly auditLogTotal: number;
  readonly pendingApprovals: number;
}

export type EngineStreamEvent =
  | { readonly type: "text_delta"; readonly text: string }
  | { readonly type: "tool_start"; readonly toolCallId: string; readonly toolName: string }
  | {
      readonly type: "tool_end";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly isError: boolean;
    }
  | { readonly type: "audit"; readonly audit: AuditEvent }
  | { readonly type: "settled" }
  | { readonly type: "error"; readonly message: string };

export type ProtocolErrorCode =
  | "parse_error"
  | "invalid_message"
  | "unsupported_version"
  | "unknown_method"
  | "invalid_params"
  | "line_too_long"
  | "unknown_approval";

export interface ProtocolError {
  readonly code: ProtocolErrorCode;
  readonly message: string;
}

export type ResponseErrorCode =
  | ProtocolErrorCode
  | "not_initialized"
  | "already_initialized"
  | "busy"
  | "init_failed"
  | "prompt_failed"
  | "aborted"
  | "shutting_down";

export type EngineMessage =
  | { readonly v: 1; readonly type: "ready"; readonly protocol: number; readonly engine: "blame" }
  | {
      readonly v: 1;
      readonly type: "response";
      readonly id: string;
      readonly ok: true;
      readonly result?: unknown;
    }
  | {
      readonly v: 1;
      readonly type: "response";
      readonly id: string;
      readonly ok: false;
      readonly error: { readonly code: ResponseErrorCode; readonly message: string };
    }
  | { readonly v: 1; readonly type: "event"; readonly event: EngineStreamEvent }
  | {
      readonly v: 1;
      readonly type: "approval_request";
      readonly id: string;
      readonly toolName: string;
      readonly toolCallId: string;
      readonly capability: string;
      readonly paths: readonly string[];
      readonly riskyClass?: string;
      readonly reason: string;
      readonly timeoutMs: number;
    }
  | {
      readonly v: 1;
      readonly type: "protocol_error";
      readonly code: ProtocolErrorCode;
      readonly message: string;
    };

export type Parsed<T> =
  | { readonly ok: true; readonly message: T }
  | { readonly ok: false; readonly error: ProtocolError; readonly id?: string };

type Obj = Record<string, unknown>;

const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const isNonEmpty = (x: unknown): x is string => typeof x === "string" && x.length > 0;
const isBool = (x: unknown): x is boolean => typeof x === "boolean";
const isStrArray = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const isTimeout = (x: unknown): x is number =>
  typeof x === "number" && Number.isInteger(x) && x > 0 && x <= 24 * 60 * 60 * 1000;

const fail = (code: ProtocolErrorCode, message: string, id?: string): Parsed<never> =>
  id === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message }, id };

function parseFrame(line: string): Parsed<Obj> {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    // The parser's message can quote input, and input can hold a key. Keep it generic.
    return fail("parse_error", "Line is not valid JSON");
  }
  if (!isObj(value)) return fail("invalid_message", "A frame must be a JSON object");
  if (value.v !== BLAME_PROTOCOL_VERSION) {
    return fail("unsupported_version", `Expected protocol version ${BLAME_PROTOCOL_VERSION}`);
  }
  return { ok: true, message: value };
}

function isPolicyContext(x: unknown): x is PolicyContext {
  return (
    isObj(x) &&
    isNonEmpty(x.presetId) &&
    isNonEmpty(x.earnedLevelId) &&
    isBool(x.optedIn) &&
    isBool(x.sandboxAvailable)
  );
}

function isModel(x: unknown): x is EngineModel {
  return isObj(x) && isNonEmpty(x.providerId) && isNonEmpty(x.modelId);
}

/** Field names only; never values, so a key in params cannot leak into an error. */
function initParamsProblem(p: unknown): string | undefined {
  if (!isObj(p)) return "params must be an object";
  if (!isNonEmpty(p.cwd)) return "params.cwd must be a non-empty string";
  if (!isModel(p.model)) return "params.model needs providerId and modelId";
  if (!isPolicyContext(p.policyContext)) return "params.policyContext is invalid";
  if (p.apiKey !== undefined && !isStr(p.apiKey)) return "params.apiKey must be a string";
  if (p.configDir !== undefined && !isNonEmpty(p.configDir)) return "params.configDir is invalid";
  if (p.tools !== undefined && !isStrArray(p.tools)) return "params.tools must be strings";
  if (p.approvalTimeoutMs !== undefined && !isTimeout(p.approvalTimeoutMs)) {
    return "params.approvalTimeoutMs must be a positive integer";
  }
  return undefined;
}

const NO_PARAM_METHODS = new Set(["abort", "blame_state", "shutdown"]);

export function parseClientMessage(line: string): Parsed<ClientMessage> {
  const frame = parseFrame(line);
  if (!frame.ok) return frame;
  const m = frame.message;
  if (m.type === "approval_response") {
    if (!isNonEmpty(m.id) || !isBool(m.approved)) {
      return fail("invalid_message", "approval_response needs id and a boolean approved");
    }
    return {
      ok: true,
      message: { v: 1, type: "approval_response", id: m.id, approved: m.approved },
    };
  }
  if (m.type !== "request") return fail("invalid_message", "Unknown frame type");
  if (!isNonEmpty(m.id)) return fail("invalid_message", "A request needs a non-empty string id");
  const id = m.id;
  if (m.method === "init") {
    const problem = initParamsProblem(m.params);
    if (problem) return fail("invalid_params", problem, id);
    return {
      ok: true,
      message: { v: 1, type: "request", id, method: "init", params: m.params as InitParams },
    };
  }
  if (m.method === "prompt") {
    if (!isObj(m.params) || !isStr(m.params.text)) {
      return fail("invalid_params", "params.text must be a string", id);
    }
    return {
      ok: true,
      message: { v: 1, type: "request", id, method: "prompt", params: { text: m.params.text } },
    };
  }
  if (isStr(m.method) && NO_PARAM_METHODS.has(m.method)) {
    return {
      ok: true,
      message: {
        v: 1,
        type: "request",
        id,
        method: m.method as "abort" | "blame_state" | "shutdown",
      },
    };
  }
  return fail("unknown_method", "Unknown method", id);
}

const PROTOCOL_ERROR_CODES = new Set<string>([
  "parse_error",
  "invalid_message",
  "unsupported_version",
  "unknown_method",
  "invalid_params",
  "line_too_long",
  "unknown_approval",
]);

function isAudit(x: unknown): x is AuditEvent {
  return (
    isObj(x) &&
    // Gate decisions, and execution guard refusals (#40, session/guard.ts).
    (x.type === "tool_decision" || x.type === "execution_violation") &&
    isStr(x.toolName) &&
    isStr(x.toolCallId) &&
    isStr(x.decision) &&
    isStr(x.reason)
  );
}

function isStreamEvent(e: unknown): e is EngineStreamEvent {
  if (!isObj(e)) return false;
  switch (e.type) {
    case "text_delta":
      return isStr(e.text);
    case "tool_start":
      return isStr(e.toolCallId) && isStr(e.toolName);
    case "tool_end":
      return isStr(e.toolCallId) && isStr(e.toolName) && isBool(e.isError);
    case "audit":
      return isAudit(e.audit);
    case "settled":
      return true;
    case "error":
      return isStr(e.message);
    default:
      return false;
  }
}

export function parseEngineMessage(line: string): Parsed<EngineMessage> {
  const frame = parseFrame(line);
  if (!frame.ok) return frame;
  const m = frame.message;
  const ok = (message: unknown): Parsed<EngineMessage> => ({
    ok: true,
    message: message as EngineMessage,
  });
  switch (m.type) {
    case "ready":
      return typeof m.protocol === "number" && m.engine === "blame"
        ? ok(m)
        : fail("invalid_message", "Bad ready frame");
    case "response":
      if (!isNonEmpty(m.id) || !isBool(m.ok)) return fail("invalid_message", "Bad response frame");
      if (m.ok === false && !(isObj(m.error) && isStr(m.error.code) && isStr(m.error.message))) {
        return fail("invalid_message", "A failed response needs error.code and error.message");
      }
      return ok(m);
    case "event":
      return isStreamEvent(m.event) ? ok(m) : fail("invalid_message", "Unknown or bad event");
    case "approval_request":
      return isNonEmpty(m.id) &&
        isStr(m.toolName) &&
        isStr(m.toolCallId) &&
        isStr(m.capability) &&
        isStrArray(m.paths) &&
        isStr(m.reason) &&
        isTimeout(m.timeoutMs) &&
        (m.riskyClass === undefined || isStr(m.riskyClass))
        ? ok(m)
        : fail("invalid_message", "Bad approval_request frame");
    case "protocol_error":
      return isStr(m.code) && PROTOCOL_ERROR_CODES.has(m.code) && isStr(m.message)
        ? ok(m)
        : fail("invalid_message", "Bad protocol_error frame");
    default:
      return fail("invalid_message", "Unknown frame type");
  }
}

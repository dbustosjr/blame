import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { PolicyContext } from "../policy/types.js";
import type { ApprovalRequest, AuditEvent } from "../session/gate.js";
import {
  APPROVAL_TIMEOUT_MS,
  type BlameSession,
  type BlameSessionOptions,
  createBlameModelRuntime,
  createBlameSession,
} from "../session/session.js";
import { attachJsonlReader, DEFAULT_MAX_LINE_LENGTH, serializeJsonLine } from "./framing.js";
import {
  BLAME_PROTOCOL_VERSION,
  type BlameState,
  type ClientRequest,
  type EngineMessage,
  type EngineModel,
  type EngineStreamEvent,
  type InitParams,
  type ProtocolErrorCode,
  parseClientMessage,
  type ResponseErrorCode,
} from "./protocol.js";
import { createStreamRedactor, redactDeep, type StreamRedactor } from "./redact.js";

export interface EngineServerOptions {
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
  /** Called once after shutdown. Default: `process.exit`. */
  readonly exit?: (code: number) => void;
  /** Tests: a model runtime with Pi's faux provider. Default: Blame's in-memory runtime. */
  readonly createModelRuntime?: () => Promise<ModelRuntime>;
  /** Tests: wrap or replace session creation. Default: createBlameSession. */
  readonly createSession?: (options: BlameSessionOptions) => Promise<BlameSession>;
  readonly maxLineLength?: number;
  /** Audit entries kept in memory and returned by blame_state, newest last. Default 1000. */
  readonly auditLogLimit?: number;
}

/** Default cap on the in-memory audit log (issue #38). */
export const DEFAULT_AUDIT_LOG_LIMIT = 1000;

export interface EngineServer {
  /** Resolves after shutdown has finished (before `exit` is called). */
  readonly closed: Promise<void>;
}

interface PendingApproval {
  readonly resolve: (approved: boolean) => void;
  readonly timer: NodeJS.Timeout;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Blame's engine over stdio (ADR-0006): wraps createBlameSession and speaks Blame's own JSONL
 * protocol, so the extension and the CLI can drive Blame in a child process. The autonomy gate's
 * "ask" goes to the client as `approval_request`; no answer before the timeout, a client that
 * goes away, an abort or shutdown all mean deny, matching the gate's fail-closed rule.
 */
export function runEngineServer(options: EngineServerOptions = {}): EngineServer {
  const input = options.input ?? process.stdin;
  const usesProcessStdout = options.output === undefined;
  const output = options.output ?? process.stdout;
  const exit = options.exit ?? ((code: number) => process.exit(code));

  // Frames own stdout. Anything else that prints (Pi, a dependency, a stray console.log) goes to
  // stderr so it cannot corrupt the protocol.
  const rawWrite: (chunk: string) => boolean = usesProcessStdout
    ? process.stdout.write.bind(process.stdout)
    : (chunk) => output.write(chunk);
  if (usesProcessStdout) {
    const toStderr = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
    process.stdout.write = toStderr;
    for (const name of ["log", "info", "debug"] as const) console[name] = console.error;
  }

  let session: BlameSession | undefined;
  let initializing = false;
  let model: EngineModel | undefined;
  let policyContext: PolicyContext | undefined;
  let approvalTimeoutMs = APPROVAL_TIMEOUT_MS;
  let apiKey: string | undefined;
  /** The running prompt's request id and a generation so a late finish after abort is ignored. */
  let running: { readonly id: string; readonly generation: number } | undefined;
  let generation = 0;
  let shuttingDown = false;
  let approvalSeq = 0;
  const approvals = new Map<string, PendingApproval>();
  const auditLogLimit = Math.max(1, options.auditLogLimit ?? DEFAULT_AUDIT_LOG_LIMIT);
  const auditLog: AuditEvent[] = [];
  let auditLogTotal = 0;
  let textRedactor: StreamRedactor = createStreamRedactor([]);
  let unsubscribe: (() => void) | undefined;

  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const send = (message: EngineMessage) => {
    if (output.writable === false) return;
    try {
      // Every frame passes the key filter: text, tool input in approvals and audit, state, errors.
      rawWrite(serializeJsonLine(apiKey ? redactDeep(message, [apiKey]) : message));
    } catch {
      // A closed pipe means the client is gone; stdin end will shut us down.
    }
  };
  const event = (e: EngineStreamEvent) => send({ v: 1, type: "event", event: e });
  /** Emits text held back by the stream redactor (a possible start of the key). */
  const flushText = () => {
    const text = textRedactor.flush();
    if (text) event({ type: "text_delta", text });
  };
  const ok = (id: string, result?: unknown) =>
    send(
      result === undefined
        ? { v: 1, type: "response", id, ok: true }
        : { v: 1, type: "response", id, ok: true, result },
    );
  const redact = (text: string) =>
    apiKey && apiKey.length > 0 ? text.split(apiKey).join("[redacted]") : text;
  const fail = (id: string, code: ResponseErrorCode, message: string) =>
    send({ v: 1, type: "response", id, ok: false, error: { code, message: redact(message) } });
  const protocolError = (code: ProtocolErrorCode, message: string) =>
    send({ v: 1, type: "protocol_error", code, message });

  const denyAllApprovals = () => {
    for (const [id, pending] of approvals) {
      clearTimeout(pending.timer);
      approvals.delete(id);
      pending.resolve(false);
    }
  };

  const approve = (request: ApprovalRequest): Promise<boolean> => {
    if (shuttingDown) return Promise.resolve(false);
    const id = `approval-${++approvalSeq}`;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        approvals.delete(id);
        resolve(false);
      }, approvalTimeoutMs);
      approvals.set(id, { resolve, timer });
      send({
        v: 1,
        type: "approval_request",
        id,
        toolName: request.toolName,
        toolCallId: request.toolCallId,
        capability: request.action.capability,
        paths: [...(request.action.paths ?? [])],
        ...(request.action.riskyClass === undefined
          ? {}
          : { riskyClass: request.action.riskyClass }),
        reason: request.result.reason,
        timeoutMs: approvalTimeoutMs,
      });
    });
  };

  const state = (): BlameState => ({
    protocol: BLAME_PROTOCOL_VERSION,
    initialized: session !== undefined,
    running: running !== undefined,
    ...(model === undefined ? {} : { model }),
    ...(policyContext === undefined ? {} : { policyContext }),
    auditLog: [...auditLog],
    auditLogTotal,
    pendingApprovals: approvals.size,
  });

  const init = async (id: string, params: InitParams) => {
    if (session !== undefined || initializing) {
      fail(id, "already_initialized", "The engine is already initialized");
      return;
    }
    initializing = true;
    apiKey = params.apiKey;
    try {
      const modelRuntime = await (options.createModelRuntime ?? createBlameModelRuntime)();
      const context = params.policyContext;
      const created = await (options.createSession ?? createBlameSession)({
        cwd: params.cwd,
        model: params.model,
        ...(params.apiKey === undefined ? {} : { apiKey: params.apiKey }),
        ...(params.configDir === undefined ? {} : { configDir: params.configDir }),
        ...(params.tools === undefined ? {} : { tools: params.tools }),
        policyContext: () => context,
        approve,
        onAudit: (audit) => {
          auditLog.push(audit);
          auditLogTotal++;
          if (auditLog.length > auditLogLimit) auditLog.splice(0, auditLog.length - auditLogLimit);
          flushText();
          event({ type: "audit", audit });
        },
        auditLogLimit,
        modelRuntime,
      });
      if (shuttingDown) {
        created.dispose();
        return;
      }
      session = created;
      model = { providerId: params.model.providerId, modelId: params.model.modelId };
      policyContext = context;
      approvalTimeoutMs = Math.min(
        params.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS,
        APPROVAL_TIMEOUT_MS,
      );
      textRedactor = createStreamRedactor(params.apiKey ? [params.apiKey] : []);
      unsubscribe = created.pi.subscribe((e) => {
        if (e.type === "message_update" && e.assistantMessageEvent.type === "text_delta") {
          const text = textRedactor.push(e.assistantMessageEvent.delta);
          if (text) event({ type: "text_delta", text });
        } else if (e.type === "message_end") {
          flushText();
        } else if (e.type === "tool_execution_start") {
          flushText();
          event({ type: "tool_start", toolCallId: e.toolCallId, toolName: e.toolName });
        } else if (e.type === "tool_execution_end") {
          event({
            type: "tool_end",
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            isError: e.isError,
          });
        }
      });
      ok(id);
    } catch (error) {
      fail(id, "init_failed", errorText(error));
      apiKey = undefined;
    } finally {
      initializing = false;
    }
  };

  const prompt = async (id: string, text: string) => {
    const current = session;
    if (current === undefined) return fail(id, "not_initialized", "Send init first");
    if (running !== undefined) return fail(id, "busy", "A prompt is already running");
    const mine = { id, generation: ++generation };
    running = mine;
    try {
      await current.prompt(text);
      if (running !== mine) return;
      running = undefined;
      flushText();
      event({ type: "settled" });
      ok(id);
    } catch (error) {
      if (running !== mine) return;
      running = undefined;
      event({ type: "error", message: redact(errorText(error)) });
      event({ type: "settled" });
      fail(id, "prompt_failed", errorText(error));
    }
  };

  const abort = async (id: string) => {
    // Synchronous first: a request after this line sees the prompt as stopped.
    const stopped = running;
    running = undefined;
    denyAllApprovals();
    if (stopped !== undefined) {
      event({ type: "settled" });
      fail(stopped.id, "aborted", "The prompt was aborted");
    }
    try {
      await session?.pi.abort();
    } catch {
      // Abort is best effort; the prompt is already reported as stopped.
    }
    ok(id);
  };

  const shutdown = async (code: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    detach();
    denyAllApprovals();
    unsubscribe?.();
    try {
      session?.dispose();
    } catch {
      // Exit anyway.
    }
    session = undefined;
    await new Promise<void>((resolve) => {
      if ((output as { writableNeedDrain?: boolean }).writableNeedDrain)
        output.once("drain", () => resolve());
      else resolve();
    });
    resolveClosed();
    exit(code);
  };

  const handleRequest = (request: ClientRequest) => {
    if (shuttingDown) return fail(request.id, "shutting_down", "The engine is shutting down");
    switch (request.method) {
      case "init":
        return void init(request.id, request.params);
      case "prompt":
        return void prompt(request.id, request.params.text);
      case "abort":
        return void abort(request.id);
      case "blame_state":
        return ok(request.id, state());
      case "shutdown":
        ok(request.id);
        return void shutdown(0);
    }
  };

  const onLine = (line: string) => {
    const parsed = parseClientMessage(line);
    if (!parsed.ok) {
      if (parsed.id !== undefined) fail(parsed.id, parsed.error.code, parsed.error.message);
      else protocolError(parsed.error.code, parsed.error.message);
      return;
    }
    const message = parsed.message;
    if (message.type === "approval_response") {
      const pending = approvals.get(message.id);
      if (pending === undefined) {
        protocolError("unknown_approval", "No pending approval with that id");
        return;
      }
      approvals.delete(message.id);
      clearTimeout(pending.timer);
      pending.resolve(message.approved === true);
      return;
    }
    handleRequest(message);
  };

  const detach = attachJsonlReader(input, {
    onLine,
    onOversized: () => protocolError("line_too_long", "Line exceeds the maximum length; dropped"),
    maxLineLength: options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH,
  });
  // The client closing stdin (or dying) ends the engine.
  input.on("end", () => void shutdown(0));
  input.on("error", () => void shutdown(1));
  output.on("error", () => void shutdown(1));
  if (usesProcessStdout) {
    process.on("SIGTERM", () => void shutdown(143));
  }

  send({ v: 1, type: "ready", protocol: BLAME_PROTOCOL_VERSION, engine: "blame" });
  return { closed };
}

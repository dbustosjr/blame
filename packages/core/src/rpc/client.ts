import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { APPROVAL_TIMEOUT_MS } from "../session/constants.js";
import { attachJsonlReader, DEFAULT_MAX_LINE_LENGTH, serializeJsonLine } from "./framing.js";
import {
  BLAME_PROTOCOL_VERSION,
  type BlameState,
  type ClientMessage,
  type EngineMessage,
  type EngineStreamEvent,
  type InitParams,
  type ProtocolError,
  parseEngineMessage,
  type RequestMethod,
} from "./protocol.js";
import { buildEngineEnv, isSupportedNodeVersion, resolveEngineRuntime } from "./runtime.js";

export type ApprovalPrompt = Omit<
  Extract<EngineMessage, { type: "approval_request" }>,
  "v" | "type"
>;

/**
 * Asks the human. Only a resolved `true` approves. A throw, any other value, or no answer
 * before the timeout is a deny (the `signal` aborts then, so the host can close its dialog).
 */
export type ApprovalHandler = (
  request: ApprovalPrompt,
  signal: AbortSignal,
) => Promise<boolean> | boolean;

export interface EngineExitInfo {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface BlameEngineClientOptions {
  readonly onApproval: ApprovalHandler;
  /** Engine entry script. Default: the built `main.js` next to this file. */
  readonly entry?: string;
  /** Executable to run the entry with. Default: resolveEngineRuntime (process.execPath). */
  readonly command?: string;
  /** Node to try when the host's Node is too old, for example "node". */
  readonly fallbackNode?: string;
  /** Extra arguments before the entry, for example Node flags. */
  readonly args?: readonly string[];
  readonly cwd?: string;
  /**
   * Host environment the child's allowlist is taken from (buildEngineEnv). Default: process.env.
   * The child never gets the whole environment.
   */
  readonly env?: NodeJS.ProcessEnv;
  /** Extra variables for the child, passed as is. Not for keys: send those in `init`. */
  readonly extraEnv?: Readonly<Record<string, string>>;
  /** Host side cap on one approval. Default APPROVAL_TIMEOUT_MS; the engine's own cap also applies. */
  readonly approvalTimeoutMs?: number;
  /** Timeout for requests other than prompt. Default 30 s. */
  readonly requestTimeoutMs?: number;
  /** Time to wait for the engine's ready frame. Default 30 s. */
  readonly startTimeoutMs?: number;
  readonly maxLineLength?: number;
}

export class EngineError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

export class EngineTimeoutError extends EngineError {
  constructor(what: string, ms: number) {
    super(`${what} timed out after ${ms} ms`, "timeout");
    this.name = "EngineTimeoutError";
  }
}

export class EngineExitedError extends EngineError {
  constructor(
    readonly exitCode: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly stderrTail: string,
  ) {
    super(
      `Blame engine exited (code ${exitCode ?? "none"}, signal ${signal ?? "none"})${stderrTail ? `: ${stderrTail.slice(-500)}` : ""}`,
      "exited",
    );
    this.name = "EngineExitedError";
  }
}

const STDERR_LIMIT = 64 * 1024;

interface Pending {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly cleanup: () => void;
}

function defaultEntry(): string {
  return fileURLToPath(new URL("./main.js", import.meta.url));
}

/**
 * Drives a Blame engine child over Blame's JSONL protocol (ADR-0006). Modeled on Pi 1.5.2's
 * `RpcClient` (pending map by id, strict JSONL reader, exit handling) but spawns a configurable
 * executable (an editor's Electron as Node by default) and answers approval requests.
 */
export class BlameEngineClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private readonly pending = new Map<string, Pending>();
  private readonly approvalControllers = new Set<AbortController>();
  private readonly eventListeners = new Set<(event: EngineStreamEvent) => void>();
  private readonly exitListeners = new Set<(info: EngineExitInfo) => void>();
  private readonly protocolErrorListeners = new Set<(error: ProtocolError) => void>();
  private readonly stderrListeners = new Set<(text: string) => void>();
  private seq = 0;
  private stderrText = "";
  private exitError: EngineExitedError | undefined;
  private exitInfo: EngineExitInfo | undefined;
  private exited: Promise<EngineExitInfo> | undefined;
  private readyWaiter:
    | { resolve: (m: { protocol: number; engine: string }) => void; reject: (e: Error) => void }
    | undefined;

  constructor(private readonly options: BlameEngineClientOptions) {}

  /** Collected stderr, capped at the last 64 KiB. */
  get stderr(): string {
    return this.stderrText;
  }

  onEvent(listener: (event: EngineStreamEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onExit(listener: (info: EngineExitInfo) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  /** Protocol errors the engine reported, and engine lines this client could not parse. */
  onProtocolError(listener: (error: ProtocolError) => void): () => void {
    this.protocolErrorListeners.add(listener);
    return () => this.protocolErrorListeners.delete(listener);
  }

  /** Engine stderr as it arrives, raw. Hosts must redact before showing it. */
  onStderr(listener: (text: string) => void): () => void {
    this.stderrListeners.add(listener);
    return () => this.stderrListeners.delete(listener);
  }

  /** Spawns the engine and waits for its `ready` frame. */
  async start(): Promise<{ protocol: number; engine: string }> {
    if (this.child) throw new EngineError("Engine already started", "already_started");
    const env = buildEngineEnv(this.options.env ?? process.env, {
      ...(this.options.extraEnv === undefined ? {} : { extraEnv: this.options.extraEnv }),
    });
    const runtime = resolveEngineRuntime({
      ...(this.options.command === undefined ? {} : { command: this.options.command }),
      ...(this.options.fallbackNode === undefined
        ? {}
        : { fallbackNode: this.options.fallbackNode }),
      execPath: process.execPath,
      versions: process.versions,
      env,
    });
    if (!runtime.ok) throw new EngineError(runtime.reason, "unsupported_node");
    if (runtime.needsVersionCheck) {
      const probe = spawnSync(runtime.command, ["--version"], {
        encoding: "utf8",
        env: runtime.env,
        windowsHide: true,
        timeout: 10_000,
      });
      const version = probe.stdout?.trim() ?? "";
      if (probe.status !== 0 || !isSupportedNodeVersion(version)) {
        throw new EngineError(
          `${runtime.command} is not Node 22.19 or newer (${version || "not found"})`,
          "unsupported_node",
        );
      }
    }

    const child = spawn(
      runtime.command,
      [...(this.options.args ?? []), this.options.entry ?? defaultEntry()],
      {
        cwd: this.options.cwd,
        env: runtime.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.child = child;
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      this.stderrText = (this.stderrText + text).slice(-STDERR_LIMIT);
      for (const listener of this.stderrListeners) {
        try {
          listener(text);
        } catch {
          // A failing listener must not break the engine stream.
        }
      }
    });
    child.stdin.on("error", () => {
      // EPIPE after a crash; the exit handler reports it.
    });
    attachJsonlReader(child.stdout, {
      onLine: (line) => this.onLine(line),
      onOversized: () =>
        this.emitProtocolError({ code: "line_too_long", message: "Engine line too long; dropped" }),
      maxLineLength: this.options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH,
    });
    this.exited = new Promise<EngineExitInfo>((resolve) => {
      let done = false;
      const finish = (info: EngineExitInfo, error?: Error) => {
        if (done) return;
        done = true;
        this.handleExit(info, error);
        resolve(info);
      };
      child.once("exit", (code, signal) => finish({ code, signal }));
      child.once("error", (error) => finish({ code: null, signal: null }, error));
    });

    const timeoutMs = this.options.startTimeoutMs ?? 30_000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyWaiter = undefined;
        child.kill();
        reject(new EngineTimeoutError("Engine start", timeoutMs));
      }, timeoutMs);
      this.readyWaiter = {
        resolve: (m) => {
          clearTimeout(timer);
          this.readyWaiter = undefined;
          if (m.protocol !== BLAME_PROTOCOL_VERSION) {
            child.kill();
            reject(
              new EngineError(
                `Engine speaks protocol ${m.protocol}; this client needs ${BLAME_PROTOCOL_VERSION}`,
                "unsupported_version",
              ),
            );
            return;
          }
          resolve(m);
        },
        reject: (e) => {
          clearTimeout(timer);
          this.readyWaiter = undefined;
          reject(e);
        },
      };
    });
  }

  async init(params: InitParams): Promise<void> {
    await this.request("init", params);
  }

  /**
   * Runs one prompt. Resolves when the engine settles. On timeout or abort the client sends
   * `abort` to the engine (which denies any open approval) and rejects.
   */
  async prompt(
    text: string,
    options: { readonly timeoutMs?: number; readonly signal?: AbortSignal } = {},
  ): Promise<void> {
    await this.request(
      "prompt",
      { text },
      { ...options, abortOnCancel: true, noDefaultTimeout: true },
    );
  }

  async abort(): Promise<void> {
    await this.request("abort");
  }

  async state(): Promise<BlameState> {
    return (await this.request("blame_state")) as BlameState;
  }

  /**
   * Asks the engine to shut down, then escalates to SIGTERM and SIGKILL if it does not exit.
   * Safe to call more than once and after a crash.
   */
  async stop(options: { readonly timeoutMs?: number } = {}): Promise<void> {
    const child = this.child;
    if (child === undefined || this.exited === undefined || this.exitInfo !== undefined) return;
    const timeoutMs = options.timeoutMs ?? 5_000;
    this.request("shutdown", undefined, { timeoutMs }).catch(() => {});
    child.stdin.end();
    const waitExit = (ms: number) =>
      Promise.race([
        this.exited?.then(() => true) ?? Promise.resolve(true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms).unref()),
      ]);
    if (await waitExit(timeoutMs)) return;
    child.kill("SIGTERM");
    if (await waitExit(2_000)) return;
    child.kill("SIGKILL");
    await this.exited;
  }

  /** Tests only: write raw bytes to the engine's stdin. */
  writeRawForTest(text: string): void {
    this.child?.stdin.write(text);
  }

  private send(message: ClientMessage): void {
    const child = this.child;
    if (child === undefined || this.exitInfo !== undefined || !child.stdin.writable) return;
    child.stdin.write(serializeJsonLine(message));
  }

  private request(
    method: RequestMethod,
    params?: unknown,
    options: {
      readonly timeoutMs?: number;
      readonly signal?: AbortSignal;
      readonly abortOnCancel?: boolean;
      readonly noDefaultTimeout?: boolean;
    } = {},
  ): Promise<unknown> {
    if (this.exitError) return Promise.reject(this.exitError);
    if (this.child === undefined) {
      return Promise.reject(new EngineError("Engine not started", "not_started"));
    }
    if (options.signal?.aborted) {
      return Promise.reject(new EngineError(`${method} aborted`, "aborted"));
    }
    const id = String(++this.seq);
    const timeoutMs =
      options.timeoutMs ??
      (options.noDefaultTimeout ? undefined : (this.options.requestTimeoutMs ?? 30_000));
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const onAbort = () => {
        cleanup();
        if (options.abortOnCancel) this.abort().catch(() => {});
        reject(new EngineError(`${method} aborted`, "aborted"));
      };
      const cleanup = () => {
        this.pending.delete(id);
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      };
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          cleanup();
          if (options.abortOnCancel) this.abort().catch(() => {});
          reject(new EngineTimeoutError(method, timeoutMs));
        }, timeoutMs);
      }
      options.signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, { resolve, reject, cleanup });
      const message =
        params === undefined
          ? { v: 1, type: "request", id, method }
          : { v: 1, type: "request", id, method, params };
      this.send(message as ClientMessage);
    });
  }

  private onLine(line: string): void {
    const parsed = parseEngineMessage(line);
    if (!parsed.ok) {
      this.emitProtocolError(parsed.error);
      return;
    }
    const m = parsed.message;
    switch (m.type) {
      case "ready":
        this.readyWaiter?.resolve({ protocol: m.protocol, engine: m.engine });
        return;
      case "response": {
        const pending = this.pending.get(m.id);
        if (pending === undefined) return; // timed out or aborted already
        pending.cleanup();
        if (m.ok) pending.resolve(m.result);
        else pending.reject(new EngineError(`${m.error.code}: ${m.error.message}`, m.error.code));
        return;
      }
      case "event":
        for (const listener of this.eventListeners) {
          try {
            listener(m.event);
          } catch {
            // One bad listener must not stop the stream.
          }
        }
        return;
      case "approval_request":
        void this.answerApproval(m);
        return;
      case "protocol_error":
        this.emitProtocolError({ code: m.code, message: m.message });
        return;
    }
  }

  private async answerApproval(m: Extract<EngineMessage, { type: "approval_request" }>) {
    const { v: _v, type: _t, ...request } = m;
    const controller = new AbortController();
    this.approvalControllers.add(controller);
    const limit = Math.min(m.timeoutMs, this.options.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(false);
      }, limit);
    });
    let approved = false;
    try {
      const answer = Promise.resolve().then(() =>
        this.options.onApproval(request, controller.signal),
      );
      answer.catch(() => {});
      approved = (await Promise.race([answer, timeout])) === true && !controller.signal.aborted;
    } catch {
      approved = false;
    } finally {
      if (timer) clearTimeout(timer);
      this.approvalControllers.delete(controller);
    }
    this.send({ v: 1, type: "approval_response", id: m.id, approved });
  }

  private emitProtocolError(error: ProtocolError): void {
    for (const listener of this.protocolErrorListeners) {
      try {
        listener(error);
      } catch {
        // Ignore listener failures.
      }
    }
  }

  private handleExit(info: EngineExitInfo, spawnError?: Error): void {
    this.exitInfo = info;
    const error = new EngineExitedError(
      info.code,
      info.signal,
      spawnError ? `${spawnError.message}\n${this.stderrText}` : this.stderrText,
    );
    this.exitError = error;
    this.readyWaiter?.reject(error);
    for (const pending of [...this.pending.values()]) {
      pending.cleanup();
      pending.reject(error);
    }
    for (const controller of this.approvalControllers) controller.abort();
    this.approvalControllers.clear();
    for (const listener of this.exitListeners) {
      try {
        listener(info);
      } catch {
        // Ignore listener failures.
      }
    }
  }
}

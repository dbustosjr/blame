import type {
  ApprovalPrompt,
  BlameEngineClientOptions,
  BlameState,
  EngineExitInfo,
  EngineStreamEvent,
  InitParams,
  PolicyContext,
} from "@blame-ai/core/engine-client";
import {
  createStreamRedactor,
  redactDeep,
  type StreamRedactor,
} from "@blame-ai/core/engine-client";

/** The part of BlameEngineClient the host uses, so tests can pass a fake. */
export interface EngineClientLike {
  start(): Promise<unknown>;
  init(params: InitParams): Promise<void>;
  prompt(text: string, options?: { readonly signal?: AbortSignal }): Promise<void>;
  abort(): Promise<void>;
  state(): Promise<BlameState>;
  stop(options?: { readonly timeoutMs?: number }): Promise<void>;
  onEvent(listener: (event: EngineStreamEvent) => void): () => void;
  onExit(listener: (info: EngineExitInfo) => void): () => void;
  onStderr(listener: (text: string) => void): () => void;
}

export type PresetId = "manual" | "guided" | "autonomous";

export interface EngineSettings {
  readonly providerId: string;
  readonly modelId: string;
  readonly presetId: PresetId;
}

export interface EngineHostDeps {
  /** Absolute path of the bundled engine (dist/engine.mjs). Always passed explicitly. */
  readonly entry: string;
  /** Where the engine keeps Pi's config and sessions (the extension's global storage). */
  readonly configDir: string;
  readonly createClient: (options: BlameEngineClientOptions) => EngineClientLike;
  /** Reads the BYOK key from SecretStorage. It only ever goes to the engine in `init`. */
  readonly getApiKey: (providerId: string) => Promise<string | undefined>;
  readonly getSettings: () => EngineSettings;
  readonly getWorkspace: () => { readonly cwd: string; readonly trusted: boolean } | undefined;
  /** Asks the human. Anything but a resolved `true` is a deny. */
  readonly presentApproval: (req: ApprovalPrompt, signal: AbortSignal) => Promise<boolean>;
  readonly log: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
  readonly transcript: { append(text: string): void };
  /** Tells the user something they need to know now (an info message in VS Code). */
  readonly notify: (message: string) => void;
  readonly approvalTimeoutMs?: number;
}

export type EngineHostErrorCode =
  | "no_workspace"
  | "untrusted_workspace"
  | "no_model"
  | "no_key"
  | "disposed"
  | "start_failed"
  | "settings_changed";

export class EngineHostError extends Error {
  constructor(
    message: string,
    readonly code: EngineHostErrorCode,
  ) {
    super(message);
    this.name = "EngineHostError";
  }
}

/**
 * The extension's side of the engine: one child process per window, started on the first task.
 * Fails closed on approvals, redacts the key from everything it shows, and treats a crash as the
 * end of that engine (the next task starts a fresh one; resuming the session is not built yet).
 */
export type EngineChange = "settings" | "key";

const CHANGE_REASON: Record<EngineChange, string> = {
  settings: "your Blame settings changed",
  key: "your model key changed",
};

/** Redacts a byte stream that can split a key across chunks, then emits whole lines. */
class LineRedactor {
  private buffer = "";
  constructor(
    private readonly redactor: StreamRedactor,
    private readonly emit: (line: string) => void,
  ) {}
  push(text: string): void {
    this.buffer += this.redactor.push(text);
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) this.emitLine(line);
  }
  flush(): void {
    this.buffer += this.redactor.flush();
    const rest = this.buffer;
    this.buffer = "";
    for (const line of rest.split("\n")) this.emitLine(line);
  }
  private emitLine(line: string): void {
    const clean = line.trimEnd();
    if (clean !== "") this.emit(clean);
  }
}

export class EngineHost {
  private client: EngineClientLike | undefined;
  private starting: Promise<EngineClientLike> | undefined;
  /** Every key this host has sent, so an old key in a late log line is still redacted. */
  private secrets: string[] = [];
  private disposed = false;
  private prompting = 0;
  /** Bumped on every settings or key change; an engine started under an older one is stale. */
  private generation = 0;
  private changes: Promise<void> = Promise.resolve();
  /** Engines Blame stopped on purpose: their exit is not a crash. */
  private readonly retired = new WeakSet<EngineClientLike>();
  /** Engines stopped mid-task because of a change, with the reason for the task's error. */
  private readonly interrupted = new WeakMap<EngineClientLike, string>();
  private readonly flushers = new WeakMap<EngineClientLike, () => void>();

  constructor(private readonly deps: EngineHostDeps) {}

  /** True while an engine child is up. */
  get running(): boolean {
    return this.client !== undefined;
  }

  /** True while a task is running. */
  get busy(): boolean {
    return this.prompting > 0;
  }

  /** Runs one task. Text streams to the transcript; approvals go to the presenter. */
  async prompt(text: string): Promise<void> {
    const client = await this.ensureEngine();
    this.prompting++;
    try {
      await client.prompt(text);
    } catch (error) {
      const reason = this.interrupted.get(client);
      if (reason !== undefined) {
        throw new EngineHostError(
          `The task stopped because ${reason}. Run it again to use the new settings.`,
          "settings_changed",
        );
      }
      throw this.cleanError(error);
    } finally {
      this.prompting--;
    }
  }

  /** Cancels the running task. Its pending approvals are denied by the engine. */
  async abort(): Promise<void> {
    if (this.client === undefined || this.prompting === 0) return;
    await this.client.abort().catch((error: unknown) => {
      this.deps.log.warn(`Abort failed: ${this.redact(String(error))}`);
    });
  }

  /** Engine state for diagnostics and tests. Starts the engine if needed. */
  async state(): Promise<BlameState> {
    const client = await this.ensureEngine();
    return client.state();
  }

  /**
   * Call when any `blame.*` setting or a stored key changes. No engine: nothing to do. Idle engine:
   * restart it so the new preset, model or key applies now. Running task: stop the task and the
   * engine and tell the user; the next task starts fresh. An engine that is still starting checks
   * the generation after init and restarts itself, so no engine keeps running under old settings.
   */
  settingsChanged(change: EngineChange): Promise<void> {
    this.generation++;
    const apply = () => this.applyChange(change);
    this.changes = this.changes.then(apply, apply);
    return this.changes;
  }

  private async applyChange(change: EngineChange): Promise<void> {
    if (this.disposed) return;
    const client = this.client;
    if (client === undefined) return;
    const reason = CHANGE_REASON[change];
    // Detach first so nothing new reaches the old engine while it stops.
    this.client = undefined;
    if (this.prompting > 0) {
      this.interrupted.set(client, reason);
      await this.retire(client, true);
      this.deps.log.info(`Stopped the running task and the engine because ${reason}.`);
      this.deps.notify(
        `Blame stopped the running task because ${reason}. Run it again to use the new settings.`,
      );
      return;
    }
    await this.retire(client, false);
    this.deps.log.info(`Restarting the Blame engine because ${reason}.`);
    try {
      await this.ensureEngine();
    } catch (error) {
      this.deps.log.warn(
        `The Blame engine did not restart (${this.cleanError(error).message}). The next task starts a new engine.`,
      );
    }
  }

  private async retire(client: EngineClientLike, abortFirst: boolean): Promise<void> {
    this.retired.add(client);
    if (abortFirst) await client.abort().catch(() => {});
    await client.stop({ timeoutMs: 2_000 }).catch(() => {});
    this.flushers.get(client)?.();
  }

  /** Shuts the engine down (shutdown, then SIGTERM, then SIGKILL). Safe to call twice. */
  async dispose(): Promise<void> {
    this.disposed = true;
    const client = this.client ?? (await this.starting?.catch(() => undefined));
    this.client = undefined;
    this.starting = undefined;
    if (client) await this.retire(client, false);
  }

  private ensureEngine(): Promise<EngineClientLike> {
    if (this.disposed) {
      return Promise.reject(new EngineHostError("Blame is shutting down.", "disposed"));
    }
    if (this.client !== undefined) return Promise.resolve(this.client);
    this.starting ??= this.startEngine().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async startEngine(): Promise<EngineClientLike> {
    const generation = this.generation;
    const workspace = this.deps.getWorkspace();
    if (workspace === undefined) {
      throw new EngineHostError("Open a folder to run Blame on it.", "no_workspace");
    }
    if (!workspace.trusted) {
      throw new EngineHostError(
        "Blame does not run in Restricted Mode. Trust this folder first.",
        "untrusted_workspace",
      );
    }
    const settings = this.deps.getSettings();
    if (settings.providerId.trim() === "" || settings.modelId.trim() === "") {
      throw new EngineHostError(
        "Set blame.model.provider and blame.model.id in Settings.",
        "no_model",
      );
    }
    const apiKey = await this.deps.getApiKey(settings.providerId);
    if (apiKey === undefined || apiKey === "") {
      throw new EngineHostError(`Add a model key for ${settings.providerId}.`, "no_key");
    }
    if (!this.secrets.includes(apiKey)) this.secrets = [...this.secrets, apiKey];

    const client = this.deps.createClient({
      entry: this.deps.entry,
      cwd: workspace.cwd,
      onApproval: (req, signal) => this.approve(req, signal),
      ...(this.deps.approvalTimeoutMs === undefined
        ? {}
        : { approvalTimeoutMs: this.deps.approvalTimeoutMs }),
    });
    // Stream redaction: a key split across two stderr chunks or two text deltas is still caught.
    const stderr = new LineRedactor(createStreamRedactor(this.secrets), (line) =>
      this.deps.log.warn(`engine: ${line}`),
    );
    const text = createStreamRedactor(this.secrets);
    const flushText = () => {
      const rest = text.flush();
      if (rest !== "") this.deps.transcript.append(rest);
    };
    this.flushers.set(client, () => {
      stderr.flush();
      flushText();
    });
    client.onStderr((chunk) => stderr.push(chunk));
    client.onEvent((event) => this.onEvent(event, text, flushText));
    client.onExit((info) => {
      stderr.flush();
      flushText();
      if (this.retired.has(client)) return;
      if (this.client !== client && this.starting === undefined) return;
      this.client = undefined;
      if (this.disposed) return;
      this.deps.log.error(
        `Blame engine exited (code ${info.code ?? "none"}, signal ${info.signal ?? "none"}). The next task starts a new engine.`,
      );
    });

    // No workspace opt-in and no sandbox exist in the extension yet, so both are reported false.
    // Manual and Guided ask before every shell command. Autonomous needs both, so the policy
    // blocks every tool call in it until the sandbox ships (R-AUTO-1, R-AUTO-4, issue #26).
    const policyContext: PolicyContext = {
      presetId: settings.presetId,
      earnedLevelId: "L1",
      optedIn: false,
      sandboxAvailable: false,
    };
    try {
      await client.start();
      await client.init({
        cwd: workspace.cwd,
        configDir: this.deps.configDir,
        model: { providerId: settings.providerId, modelId: settings.modelId },
        apiKey,
        policyContext,
      });
    } catch (error) {
      await this.retire(client, false);
      const clean = this.cleanError(error);
      this.deps.log.error(`Blame engine failed to start: ${clean.message}`);
      throw new EngineHostError(clean.message, "start_failed");
    }
    if (this.disposed) {
      await this.retire(client, false);
      throw new EngineHostError("Blame is shutting down.", "disposed");
    }
    if (generation !== this.generation) {
      // Settings or the key changed while this engine started: never keep it.
      await this.retire(client, false);
      this.deps.log.info("Settings changed while the engine started; starting it again.");
      return this.startEngine();
    }
    this.client = client;
    this.deps.log.info(
      `Blame engine ready: ${settings.providerId}/${settings.modelId}, preset ${settings.presetId}.`,
    );
    return client;
  }

  private async approve(req: ApprovalPrompt, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false;
    try {
      const answer = await this.deps.presentApproval(req, signal);
      const approved = answer === true && !signal.aborted;
      this.deps.log.info(
        `${approved ? "Approved" : "Denied"} ${req.toolName}${req.paths.length > 0 ? ` on ${req.paths.join(", ")}` : ""}.`,
      );
      return approved;
    } catch (error) {
      this.deps.log.warn(
        `Approval dialog failed, denied ${req.toolName}: ${this.redact(String(error))}`,
      );
      return false;
    }
  }

  private onEvent(event: EngineStreamEvent, text: StreamRedactor, flushText: () => void): void {
    switch (event.type) {
      case "text_delta": {
        const safe = text.push(event.text);
        if (safe !== "") this.deps.transcript.append(safe);
        break;
      }
      case "tool_start":
        this.deps.log.info(`Tool ${event.toolName} started.`);
        break;
      case "tool_end":
        this.deps.log.info(`Tool ${event.toolName} ${event.isError ? "failed" : "finished"}.`);
        break;
      case "audit":
        this.deps.log.info(`Audit: ${this.redact(JSON.stringify(event.audit))}`);
        break;
      case "error":
        this.deps.log.error(`Engine error: ${this.redact(event.message)}`);
        break;
      case "settled":
        flushText();
        this.deps.transcript.append("\n");
        break;
    }
  }

  private redact(text: string): string {
    return redactDeep(text, this.secrets);
  }

  private cleanError(error: unknown): Error {
    if (error instanceof EngineHostError) return error;
    const message = this.redact(error instanceof Error ? error.message : String(error));
    const clean = new Error(message);
    clean.name = error instanceof Error ? error.name : "Error";
    return clean;
  }
}

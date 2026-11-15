import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import {
  type ApprovalHandler,
  BlameEngineClient,
  type BlameEngineClientOptions,
  createStreamRedactor,
  type EngineExitInfo,
  type EngineStreamEvent,
  type InitParams,
  redactDeep,
  type StreamRedactor,
} from "@blame-ai/core/engine-client";
import { createTerminalSanitizer, sanitizeForTerminal } from "../sanitize.js";
import type { Theme } from "../theme.js";
import { escapeControl } from "../wrap.js";
import type { KeySource } from "./keySource.js";

/** The part of BlameEngineClient runTask uses, so tests can pass a fake. */
export interface EngineClientLike {
  start(): Promise<unknown>;
  init(params: InitParams): Promise<void>;
  prompt(text: string, options?: { readonly signal?: AbortSignal }): Promise<void>;
  abort(): Promise<void>;
  stop(options?: { readonly timeoutMs?: number }): Promise<void>;
  onEvent(listener: (event: EngineStreamEvent) => void): () => void;
  onExit(listener: (info: EngineExitInfo) => void): () => void;
  onStderr(listener: (text: string) => void): () => void;
}

/** Where SIGINT and SIGTERM come from. Default: the process. */
export interface SignalSource {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export interface RunTaskOptions {
  readonly task: string;
  readonly cwd: string;
  readonly presetId: string;
  readonly providerId: string;
  readonly modelId: string;
  /** Blame's config dir (default ~/.blame); Pi's agent dir lives under it. */
  readonly configDir: string;
  /** Absolute engine entry (core's dist/rpc/main.js). Always passed explicitly. */
  readonly entry: string;
  readonly keySource: KeySource;
  readonly approve: ApprovalHandler;
  readonly stdout: { write(s: string): unknown };
  readonly stderr: { write(s: string): unknown };
  readonly theme: Theme;
  /** Engine stderr to our stderr. Otherwise it goes to `logFile`. Redacted either way. */
  readonly verbose: boolean;
  readonly logFile?: string;
  /** engine.log rotates to engine.log.1 past this size. Default about 5 MB. */
  readonly logMaxBytes?: number;
  readonly signals?: SignalSource;
  createClient?: (options: BlameEngineClientOptions) => EngineClientLike;
  readonly approvalTimeoutMs?: number;
  /** How long shutdown waits before SIGTERM, then SIGKILL. Default 2 s. */
  readonly stopTimeoutMs?: number;
}

/**
 * Runs one task in a fresh engine child and returns the exit code: 0 done, 1 failed (start,
 * crash, engine error), 130 SIGINT, 143 SIGTERM. The key goes to the engine only in `init`.
 */
export async function runTask(options: RunTaskOptions): Promise<number> {
  const { theme, stdout, stderr } = options;
  const secrets: string[] = [];
  const redact = (text: string) => redactDeep(text, secrets);
  const fail = (message: string) => {
    // Engine and model text can carry terminal escapes; strip them before printing.
    stderr.write(
      `${theme.token("status.error", "blame:")} ${sanitizeForTerminal(redact(message))}\n`,
    );
  };

  const apiKey = await options.keySource.get(options.providerId);
  if (apiKey === undefined) {
    fail(
      `No model key for ${options.providerId}. Set BLAME_API_KEY for this shell, or run in a terminal to be asked.`,
    );
    return 1;
  }
  secrets.push(apiKey);

  // Stderr and text arrive in chunks, and a key can be split across two of them, so both go
  // through stream redactors (never per-chunk redactDeep). Verbose stderr is also printed by line.
  const stderrRedactor: StreamRedactor = createStreamRedactor(secrets);
  let stderrLine = "";
  const stderrSanitizer = createTerminalSanitizer();
  const logMaxBytes = options.logMaxBytes ?? 5 * 1024 * 1024;
  const writeEngineLog = (clean: string, final: boolean) => {
    if (options.verbose) {
      stderrLine += stderrSanitizer.push(clean);
      const lines = stderrLine.split(/\r?\n/);
      stderrLine = final ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (line !== "") stderr.write(`${theme.role("hint", "engine:")} ${line}\n`);
      }
      return;
    }
    if (options.logFile === undefined || clean === "") return;
    try {
      mkdirSync(dirname(options.logFile), { recursive: true });
      let size = 0;
      try {
        size = statSync(options.logFile).size;
      } catch {
        // No log yet.
      }
      if (size > 0 && size + Buffer.byteLength(clean) > logMaxBytes) {
        renameSync(options.logFile, `${options.logFile}.1`);
      }
      appendFileSync(options.logFile, clean, { mode: 0o600 });
    } catch {
      // Logging must never take the run down.
    }
  };
  const logEngine = (chunk: string) => writeEngineLog(stderrRedactor.push(chunk), false);
  const flushEngineLog = () => writeEngineLog(stderrRedactor.flush(), true);

  const create = options.createClient ?? ((o) => new BlameEngineClient(o));
  const client = create({
    entry: options.entry,
    cwd: options.cwd,
    onApproval: options.approve,
    ...(options.approvalTimeoutMs === undefined
      ? {}
      : { approvalTimeoutMs: options.approvalTimeoutMs }),
  });

  let atLineStart = true;
  const print = (text: string) => {
    if (text === "") return;
    stdout.write(text);
    atLineStart = text.endsWith("\n");
  };
  const newline = () => {
    if (!atLineStart) print("\n");
  };
  // Model text: stream redactor, then a stateful terminal sanitizer (escape sequences can be
  // split across deltas). Only \n and \t survive.
  let textRedactor: StreamRedactor = createStreamRedactor(secrets);
  let textSanitizer = createTerminalSanitizer();
  const flushText = () => {
    print(
      theme.role("assistantText", textSanitizer.push(textRedactor.flush()) + textSanitizer.flush()),
    );
    textRedactor = createStreamRedactor(secrets);
    textSanitizer = createTerminalSanitizer();
  };
  const bullet = theme.unicode ? "\u25CF" : "*";
  const corner = theme.unicode ? "\u23BF" : "L";
  let engineError = false;

  client.onStderr(logEngine);
  client.onEvent((event) => {
    if (event.type !== "text_delta") flushText();
    switch (event.type) {
      case "text_delta":
        print(theme.role("assistantText", textSanitizer.push(textRedactor.push(event.text))));
        break;
      case "tool_start":
        newline();
        print(
          `${theme.role("toolBullet", bullet)} ${theme.token("text.primary", escapeControl(event.toolName), { bold: true })}\n`,
        );
        break;
      case "tool_end":
        if (event.isError) print(`  ${theme.role("hint", `${corner} failed`)}\n`);
        break;
      case "audit":
        if (event.audit.type === "tool_decision" && event.audit.decision === "block") {
          newline();
          print(
            `  ${theme.token("status.error", `blocked ${escapeControl(event.audit.toolName)}:`)} ${sanitizeForTerminal(redact(event.audit.reason))}\n`,
          );
        }
        break;
      case "error":
        engineError = true;
        newline();
        fail(`engine error: ${event.message}`);
        break;
      case "settled":
        newline();
        break;
    }
  });

  let stopping = false;
  let interrupted: number | undefined;
  const stopTimeoutMs = options.stopTimeoutMs ?? 2_000;
  const signals: SignalSource = options.signals ?? process;
  let wake: () => void = () => {};
  const woken = new Promise<void>((resolve) => {
    wake = resolve;
  });
  const onSignal = (code: number) => () => {
    if (interrupted !== undefined) return;
    interrupted = code;
    stopping = true;
    newline();
    stderr.write(`${theme.role("hint", "Stopping Blame...")}\n`);
    wake();
  };
  const onInt = onSignal(130);
  const onTerm = onSignal(143);
  signals.on("SIGINT", onInt);
  signals.on("SIGTERM", onTerm);
  client.onExit((info) => {
    if (stopping) return;
    newline();
    fail(
      `engine exited (code ${info.code ?? "none"}, signal ${info.signal ?? "none"}). Run with --verbose to see its log.`,
    );
  });

  try {
    print(`${theme.role("userTurn", `> ${options.task}`)}\n`);
    const work = (async () => {
      try {
        await client.start();
        await client.init({
          cwd: options.cwd,
          configDir: options.configDir,
          model: { providerId: options.providerId, modelId: options.modelId },
          apiKey,
          // No opt-in and no sandbox are reported (issue #26). Guided asks before every shell
          // command; Autonomous does not run tools until the sandbox ships, because the policy
          // blocks it while sandboxAvailable is false.
          policyContext: {
            presetId: options.presetId,
            earnedLevelId: "L1",
            optedIn: false,
            sandboxAvailable: false,
          },
        });
      } catch (error) {
        if (interrupted === undefined) {
          fail(`engine failed to start: ${error instanceof Error ? error.message : String(error)}`);
        }
        return 1;
      }
      try {
        await client.prompt(options.task);
        return engineError ? 1 : 0;
      } catch (error) {
        if (interrupted === undefined && !stopping) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/exited/i.test(message)) fail(message);
        }
        return 1;
      }
    })();
    const code = await Promise.race([work, woken.then(() => undefined)]);
    if (code !== undefined && interrupted === undefined) return code;
    await client.abort().catch(() => {});
    return interrupted ?? 1;
  } finally {
    stopping = true;
    flushText();
    signals.off("SIGINT", onInt);
    signals.off("SIGTERM", onTerm);
    // shutdown, then SIGTERM, then SIGKILL if the child hangs.
    await client.stop({ timeoutMs: stopTimeoutMs }).catch(() => {});
    flushEngineLog();
  }
}

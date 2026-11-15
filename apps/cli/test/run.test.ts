import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ApprovalPrompt,
  BlameEngineClient,
  type BlameEngineClientOptions,
  type InitParams,
} from "@blame-ai/core/engine-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveEngineEntry } from "../src/engine/entry.js";
import type { KeySource } from "../src/engine/keySource.js";
import { type RunTaskOptions, runTask } from "../src/engine/run.js";
import { createTheme, stripAnsi } from "../src/theme.js";

// Real child processes: core's built engine entry, and core's faux engine fixture (the same
// stdio server with Pi's scripted faux model). test/setup/build.ts builds core first.
const coreDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "packages", "core");
const fauxEngine = join(coreDir, "test", "fixtures", "faux-engine.mjs");
const FAKE_KEY = ["sk", "blame", "cli", "fake", "key"].join("-");

type Step = { text: string } | { tool: string; args: Record<string, unknown> };

let workDir: string;
let configDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "blame-cli-work-"));
  configDir = mkdtempSync(join(tmpdir(), "blame-cli-config-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
});

function keys(value: string | null = FAKE_KEY): KeySource {
  return { name: "test", get: async () => value ?? undefined };
}

function setup(
  opts: {
    faux?: { steps: Step[]; mode?: string };
    presetId?: string;
    modelId?: string;
    approve?: RunTaskOptions["approve"];
    approvalTimeoutMs?: number;
    verbose?: boolean;
    keySource?: KeySource;
    signals?: EventEmitter;
  } = {},
) {
  let out = "";
  let err = "";
  const inits: InitParams[] = [];
  const clientOptions: BlameEngineClientOptions[] = [];
  const clients: BlameEngineClient[] = [];
  const options: RunTaskOptions = {
    task: "do the thing",
    cwd: workDir,
    presetId: opts.presetId ?? "guided",
    providerId: opts.faux ? "faux" : "anthropic",
    modelId: opts.modelId ?? (opts.faux ? "faux-1" : "claude-sonnet-4-5"),
    configDir,
    entry: resolveEngineEntry(),
    keySource: opts.keySource ?? keys(),
    approve: opts.approve ?? (async () => false),
    stdout: { write: (s: string) => (out += s) },
    stderr: { write: (s: string) => (err += s) },
    theme: createTheme("none"),
    verbose: opts.verbose ?? false,
    logFile: join(configDir, "engine.log"),
    ...(opts.signals ? { signals: opts.signals } : {}),
    ...(opts.approvalTimeoutMs === undefined ? {} : { approvalTimeoutMs: opts.approvalTimeoutMs }),
    createClient: (o) => {
      const merged: BlameEngineClientOptions = opts.faux
        ? {
            ...o,
            entry: fauxEngine,
            extraEnv: {
              BLAME_FAUX_STEPS: JSON.stringify(opts.faux.steps),
              BLAME_FAUX_MODE: opts.faux.mode ?? "",
              PI_OFFLINE: "1",
            },
          }
        : { ...o, extraEnv: { PI_OFFLINE: "1" } };
      clientOptions.push(o);
      const c = new BlameEngineClient(merged);
      const init = c.init.bind(c);
      c.init = async (params) => {
        inits.push(params);
        await init(params);
      };
      clients.push(c);
      return c;
    },
  };
  return {
    options,
    run: () => runTask(options),
    out: () => stripAnsi(out),
    err: () => stripAnsi(err),
    inits,
    clientOptions,
    clients,
  };
}

const bash = (command: string): Step[] => [{ tool: "bash", args: { command } }, { text: "ok" }];

describe("runTask with real engine processes", () => {
  it("resolves core's built engine entry explicitly", () => {
    const entry = resolveEngineEntry();
    expect(entry).toMatch(/packages[\\/]core[\\/]dist[\\/]rpc[\\/]main\.js$/);
    expect(existsSync(entry)).toBe(true);
  });

  it("spawns the real engine entry and fails cleanly on an unknown model", async () => {
    const t = setup({ modelId: "no-such-model" });
    expect(await t.run()).toBe(1);
    expect(t.clientOptions[0]?.entry).toBe(resolveEngineEntry());
    expect(t.err()).toMatch(/failed to start/i);
    expect(t.err() + t.out()).not.toContain(FAKE_KEY);
    expect(t.clients[0]?.stderr).toBeDefined();
  });

  it("streams the scripted model's text and exits 0, sending the key only in init", async () => {
    const t = setup({ faux: { steps: [{ text: "hello from Blame" }] } });
    expect(await t.run()).toBe(0);
    expect(t.out()).toContain("> do the thing");
    expect(t.out()).toContain("hello from Blame");
    expect(t.inits[0]?.apiKey).toBe(FAKE_KEY);
    expect(t.inits[0]?.policyContext).toMatchObject({ optedIn: false, sandboxAvailable: false });
    const o = t.clientOptions[0];
    expect(JSON.stringify({ env: o?.extraEnv, args: o?.args })).not.toContain(FAKE_KEY);
    expect(t.out() + t.err()).not.toContain(FAKE_KEY);
  });

  it("refuses to start with no key and spawns nothing", async () => {
    const t = setup({ keySource: keys(null) });
    expect(await t.run()).toBe(1);
    expect(t.err()).toMatch(/no model key/i);
    // Same rule as the keychain error (#51): the only env var it may name is BLAME_API_KEY.
    const envNames = new Set(t.err().match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) ?? []);
    expect([...envNames]).toEqual(["BLAME_API_KEY"]);
    expect(t.clients).toHaveLength(0);
  });

  it("Guided asks before a shell command and does not run it when denied (issue #26)", async () => {
    const approve = vi.fn(async (_r: ApprovalPrompt) => false);
    const t = setup({ faux: { steps: bash("echo ran > ran.txt") }, approve });
    expect(await t.run()).toBe(0);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve.mock.calls[0]?.[0]).toMatchObject({ toolName: "bash" });
    expect(existsSync(join(workDir, "ran.txt"))).toBe(false);
  });

  it("Autonomous runs no tools until the sandbox ships, shell included (issue #26)", async () => {
    const approve = vi.fn(async (_r: ApprovalPrompt) => true);
    const t = setup({
      faux: { steps: bash("echo ran > ran.txt") },
      presetId: "autonomous",
      approve,
    });
    expect(await t.run()).toBe(0);
    expect(approve).not.toHaveBeenCalled();
    expect(existsSync(join(workDir, "ran.txt"))).toBe(false);
    expect(t.out()).toMatch(/blocked bash: Autonomous needs an explicit opt-in/);
  });

  it("Autonomous does not run a file write either, and never asks", async () => {
    const approve = vi.fn(async (_r: ApprovalPrompt) => true);
    const t = setup({
      faux: {
        steps: [{ tool: "write", args: { path: "notes.txt", content: "x" } }, { text: "ok" }],
      },
      presetId: "autonomous",
      approve,
    });
    expect(await t.run()).toBe(0);
    expect(approve).not.toHaveBeenCalled();
    expect(existsSync(join(workDir, "notes.txt"))).toBe(false);
    expect(t.out()).toMatch(/blocked write:/);
  });

  it("denies when the approver never answers before the timeout", async () => {
    let aborted = false;
    const t = setup({
      faux: {
        steps: [{ tool: "write", args: { path: "auth/login.ts", content: "x" } }, { text: "ok" }],
      },
      approvalTimeoutMs: 300,
      approve: (_r, signal) =>
        new Promise<boolean>(() => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
        }),
    });
    expect(await t.run()).toBe(0);
    expect(aborted).toBe(true);
    expect(existsSync(join(workDir, "auth", "login.ts"))).toBe(false);
  });

  it("reports an engine crash and exits 1", async () => {
    const t = setup({ faux: { steps: [], mode: "crash_on_prompt" } });
    expect(await t.run()).toBe(1);
    expect(t.err()).toMatch(/engine exited/i);
  });

  it("shuts the engine down on SIGINT and exits 130", async () => {
    const signals = new EventEmitter();
    const t = setup({ faux: { steps: [], mode: "hang_prompt" }, signals });
    const done = t.run();
    await vi.waitFor(() => expect(t.inits).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 200));
    const exited = new Promise((r) => t.clients[0]?.onExit(r));
    signals.emit("SIGINT", "SIGINT");
    expect(await done).toBe(130);
    await expect(exited).resolves.toBeDefined();
    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });

  it("exits 143 on SIGTERM", async () => {
    const signals = new EventEmitter();
    const t = setup({ faux: { steps: [], mode: "hang_prompt" }, signals });
    const done = t.run();
    await vi.waitFor(() => expect(t.inits).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 200));
    signals.emit("SIGTERM", "SIGTERM");
    expect(await done).toBe(143);
  });

  it("writes engine stderr to the log file, or to stderr with --verbose", async () => {
    const quiet = setup({ faux: { steps: [{ text: "hi" }], mode: "stderr_banner" } });
    expect(await quiet.run()).toBe(0);
    expect(quiet.err()).not.toContain("faux engine stderr banner");
    expect(readFileSync(quiet.options.logFile as string, "utf8")).toContain(
      "faux engine stderr banner",
    );

    const loud = setup({ faux: { steps: [{ text: "hi" }], mode: "stderr_banner" }, verbose: true });
    expect(await loud.run()).toBe(0);
    expect(loud.err()).toContain("engine: faux engine stderr banner");
  });
});

describe("runTask redaction", () => {
  it("redacts the key from text, errors, stderr and the log file", async () => {
    const listeners = {
      event: [] as Array<(e: unknown) => void>,
      stderr: [] as Array<(t: string) => void>,
    };
    const fake = {
      start: async () => ({ protocol: 1, engine: "blame" }),
      init: async () => {},
      prompt: async () => {
        // A key split across chunks must not leak (stderr and text both stream).
        const half = Math.floor(FAKE_KEY.length / 2);
        for (const l of listeners.stderr) l(`split ${FAKE_KEY.slice(0, half)}`);
        for (const l of listeners.stderr) l(`${FAKE_KEY.slice(half)} end\n`);
        for (const l of listeners.event)
          l({ type: "text_delta", text: `part ${FAKE_KEY.slice(0, half)}` });
        for (const l of listeners.event)
          l({ type: "text_delta", text: `${FAKE_KEY.slice(half)} done ` });
        for (const l of listeners.stderr) l(`trace ${FAKE_KEY}\n`);
        for (const l of listeners.event) l({ type: "text_delta", text: `echo ${FAKE_KEY}` });
        for (const l of listeners.event) l({ type: "error", message: `bad ${FAKE_KEY}` });
        for (const l of listeners.event) l({ type: "settled" });
      },
      abort: async () => {},
      stop: async () => {},
      onEvent: (l: (e: unknown) => void) => {
        listeners.event.push(l);
        return () => {};
      },
      onExit: () => () => {},
      onStderr: (l: (t: string) => void) => {
        listeners.stderr.push(l);
        return () => {};
      },
    };
    for (const verbose of [false, true]) {
      const t = setup({ verbose });
      t.options.createClient = () => fake as never;
      // The engine error event makes the run fail; the point here is what got printed.
      expect(await t.run()).toBe(1);
      const shown =
        t.out() +
        t.err() +
        (existsSync(t.options.logFile as string)
          ? readFileSync(t.options.logFile as string, "utf8")
          : "");
      expect(shown).not.toContain(FAKE_KEY);
      expect(shown).toContain("echo [redacted]");
      expect(shown).toContain("trace [redacted]");
      expect(shown).toContain("split [redacted] end");
      expect(shown).toContain("part [redacted] done");
      // No piece of the key long enough to matter shows up either.
      expect(shown).not.toContain(FAKE_KEY.slice(0, Math.floor(FAKE_KEY.length / 2)));
    }
  });
});

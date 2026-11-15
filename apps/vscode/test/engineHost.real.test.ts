import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ApprovalPrompt,
  BlameEngineClient,
  type BlameEngineClientOptions,
} from "@blame-ai/core/engine-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngineHost, type EngineHostDeps, type PresetId } from "../src/engine/host";

// Real child processes: the bundled engine (dist/engine.mjs, Pi inside, no network needed to
// start) and core's faux engine fixture (the same server with Pi's faux model, scripted by env).
const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const coreDir = join(appDir, "..", "..", "packages", "core");
const bundledEngine = join(appDir, "dist", "engine.mjs");
const fauxEngine = join(coreDir, "test", "fixtures", "faux-engine.mjs");
const FAKE_KEY = ["sk", "blame", "fake", "engine", "key"].join("-");

let workDir: string;
let configDir: string;
let host: EngineHost | undefined;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "blame-ext-work-"));
  configDir = mkdtempSync(join(tmpdir(), "blame-ext-config-"));
});

afterEach(async () => {
  await host?.dispose();
  host = undefined;
  rmSync(workDir, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
});

type Step = { text: string } | { tool: string; args: Record<string, unknown> };

function makeHost(
  opts: {
    faux?: { steps: Step[]; mode?: string };
    presetId?: PresetId;
    providerId?: string;
    modelId?: string;
    presentApproval?: EngineHostDeps["presentApproval"];
    approvalTimeoutMs?: number;
  } = {},
) {
  const logs: string[] = [];
  const transcript: string[] = [];
  const clients: BlameEngineClient[] = [];
  host = new EngineHost({
    entry: bundledEngine,
    configDir,
    createClient: (options: BlameEngineClientOptions) => {
      const c = new BlameEngineClient(
        opts.faux
          ? {
              ...options,
              entry: fauxEngine,
              extraEnv: {
                BLAME_FAUX_STEPS: JSON.stringify(opts.faux.steps),
                BLAME_FAUX_MODE: opts.faux.mode ?? "",
                PI_OFFLINE: "1",
              },
            }
          : { ...options, extraEnv: { PI_OFFLINE: "1" } },
      );
      clients.push(c);
      return c;
    },
    getApiKey: async () => FAKE_KEY,
    getSettings: () => ({
      providerId: opts.providerId ?? (opts.faux ? "faux" : "anthropic"),
      modelId: opts.modelId ?? (opts.faux ? "faux-1" : "claude-sonnet-4-5"),
      presetId: opts.presetId ?? "guided",
    }),
    getWorkspace: () => ({ cwd: workDir, trusted: true }),
    presentApproval: opts.presentApproval ?? (async () => false),
    log: {
      info: (m) => logs.push(`info ${m}`),
      warn: (m) => logs.push(`warn ${m}`),
      error: (m) => logs.push(`error ${m}`),
    },
    transcript: { append: (t) => transcript.push(t) },
    ...(opts.approvalTimeoutMs === undefined ? {} : { approvalTimeoutMs: opts.approvalTimeoutMs }),
  });
  return { host, logs, transcript, clients };
}

describe("EngineHost with real engine processes", () => {
  it("spawns the bundled engine entry, inits with the key, and shuts it down", async () => {
    const { host, clients, logs } = makeHost();
    const state = await host.state();
    expect(state).toMatchObject({
      initialized: true,
      model: { providerId: "anthropic", modelId: "claude-sonnet-4-5" },
      policyContext: { presetId: "guided", optedIn: false, sandboxAvailable: false },
    });
    expect(JSON.stringify(state)).not.toContain(FAKE_KEY);
    const c = clients[0] as BlameEngineClient;
    const exited = new Promise((resolve) => c.onExit(resolve));
    await host.dispose();
    await expect(exited).resolves.toBeDefined();
    expect(host.running).toBe(false);
    expect(logs.join("\n")).not.toContain(FAKE_KEY);
  }, 60_000);

  it("reports a failed init on an unknown model and leaves no engine running", async () => {
    const { host, logs } = makeHost({ modelId: "no-such-model" });
    await expect(host.state()).rejects.toMatchObject({ code: "start_failed" });
    expect(host.running).toBe(false);
    expect(logs.join("\n")).toMatch(/failed to start/);
  }, 60_000);

  it("streams text from a prompt to the transcript", async () => {
    const { host, transcript } = makeHost({ faux: { steps: [{ text: "hello from Blame" }] } });
    await host.prompt("say hello");
    expect(transcript.join("")).toContain("hello from Blame");
  }, 60_000);

  it("shows a safe-zone write to the presenter and blocks it when denied", async () => {
    const present = vi.fn(async (_req: ApprovalPrompt) => false);
    const { host } = makeHost({
      faux: {
        steps: [{ tool: "write", args: { path: "auth/login.ts", content: "x" } }, { text: "ok" }],
      },
      presentApproval: present,
    });
    await host.prompt("edit login");
    expect(present).toHaveBeenCalledTimes(1);
    expect(present.mock.calls[0]?.[0]).toMatchObject({
      toolName: "write",
      paths: ["auth/login.ts"],
    });
    expect(existsSync(join(workDir, "auth", "login.ts"))).toBe(false);
  }, 60_000);

  it("asks before a shell command in Guided and does not run it when denied", async () => {
    const present = vi.fn(async (_req: ApprovalPrompt) => false);
    const { host } = makeHost({
      faux: {
        steps: [{ tool: "bash", args: { command: "echo ran > ran.txt" } }, { text: "ok" }],
      },
      presentApproval: present,
    });
    await host.prompt("run it");
    expect(present).toHaveBeenCalledTimes(1);
    expect(present.mock.calls[0]?.[0]).toMatchObject({ toolName: "bash" });
    expect(existsSync(join(workDir, "ran.txt"))).toBe(false);
  });

  it("never runs shell unasked in Autonomous: with no opt-in or sandbox it blocks (issue #26)", async () => {
    const present = vi.fn(async (_req: ApprovalPrompt) => true);
    const { host, logs } = makeHost({
      faux: {
        steps: [{ tool: "bash", args: { command: "echo ran > ran.txt" } }, { text: "ok" }],
      },
      presetId: "autonomous",
      presentApproval: present,
    });
    await host.prompt("run it");
    expect(existsSync(join(workDir, "ran.txt"))).toBe(false);
    const audit = logs.find((l) => l.includes('"toolName":"bash"'));
    expect(audit).toContain('"decision":"block"');
    expect(audit).toContain("explicit opt-in");
  }, 60_000);

  it("denies when the presenter never answers before the timeout", async () => {
    let sawAbort = false;
    const { host } = makeHost({
      faux: {
        steps: [{ tool: "write", args: { path: "auth/login.ts", content: "x" } }, { text: "ok" }],
      },
      approvalTimeoutMs: 300,
      presentApproval: (_req, signal) =>
        new Promise<boolean>(() => {
          signal.addEventListener("abort", () => {
            sawAbort = true;
          });
        }),
    });
    await host.prompt("edit login");
    expect(sawAbort).toBe(true);
    expect(existsSync(join(workDir, "auth", "login.ts"))).toBe(false);
  }, 60_000);

  it("surfaces an engine crash to the log and starts a new engine next time", async () => {
    const { host, logs, clients } = makeHost({ faux: { steps: [], mode: "crash_on_prompt" } });
    await expect(host.prompt("crash")).rejects.toThrow(/exited/);
    await vi.waitFor(() => expect(logs.join("\n")).toMatch(/error Blame engine exited \(code 9/));
    expect(host.running).toBe(false);
    await expect(host.prompt("again")).rejects.toThrow(/exited/);
    expect(clients).toHaveLength(2);
  }, 60_000);
});

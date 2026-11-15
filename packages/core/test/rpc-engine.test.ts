import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ApprovalPrompt,
  BlameEngineClient,
  EngineExitedError,
  type EngineStreamEvent,
  EngineTimeoutError,
  type PolicyContext,
} from "../src/index.js";

// Spawns the built engine, so build packages/core first (CI builds before tests; this keeps a
// local `pnpm test` honest too).
const coreDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const fauxEngine = join(coreDir, "test", "fixtures", "faux-engine.mjs");
const realEngine = join(coreDir, "dist", "rpc", "main.js");

beforeAll(() => {
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  execFileSync(process.execPath, [tsc, "-p", join(coreDir, "tsconfig.build.json")], {
    cwd: coreDir,
    stdio: "inherit",
  });
}, 120_000);

const guidedL2: PolicyContext = {
  presetId: "guided",
  earnedLevelId: "L2",
  optedIn: false,
  sandboxAvailable: false,
};

type Step = { text: string } | { tool: string; args: Record<string, unknown> };

let workDir: string;
let configDir: string;
let client: BlameEngineClient | undefined;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "blame-rpc-work-"));
  configDir = mkdtempSync(join(tmpdir(), "blame-rpc-config-"));
});

afterEach(async () => {
  await client?.stop();
  client = undefined;
  rmSync(workDir, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
});

function start(
  steps: Step[],
  onApproval: (req: ApprovalPrompt, signal: AbortSignal) => Promise<boolean> | boolean,
  extra: {
    mode?: string;
    approvalTimeoutMs?: number;
    entry?: string;
    hostEnv?: NodeJS.ProcessEnv;
    extraEnv?: Record<string, string>;
  } = {},
): BlameEngineClient {
  client = new BlameEngineClient({
    entry: extra.entry ?? fauxEngine,
    cwd: coreDir,
    ...(extra.hostEnv === undefined ? {} : { env: extra.hostEnv }),
    extraEnv: {
      BLAME_FAUX_STEPS: JSON.stringify(steps),
      BLAME_FAUX_MODE: extra.mode ?? "",
      PI_OFFLINE: "1",
      ...(extra.extraEnv ?? {}),
    },
    onApproval,
    ...(extra.approvalTimeoutMs === undefined
      ? {}
      : { approvalTimeoutMs: extra.approvalTimeoutMs }),
  });
  return client;
}

async function init(c: BlameEngineClient) {
  await c.start();
  await c.init({
    cwd: workDir,
    configDir,
    model: { providerId: "faux", modelId: "faux-1" },
    policyContext: guidedL2,
  });
}

const safeZoneWrite: Step[] = [
  { tool: "write", args: { path: "auth/login.ts", content: "ok" } },
  { text: "done" },
];

describe("BlameEngineClient with the stdio engine", () => {
  it("handshakes with the protocol version and reports blame_state", async () => {
    const c = start([], () => false);
    const ready = await c.start();
    expect(ready).toMatchObject({ protocol: 1, engine: "blame" });
    await c.init({
      cwd: workDir,
      configDir,
      model: { providerId: "faux", modelId: "faux-1" },
      policyContext: guidedL2,
    });
    const state = await c.state();
    expect(state).toMatchObject({
      initialized: true,
      running: false,
      model: { providerId: "faux", modelId: "faux-1" },
      policyContext: guidedL2,
      auditLog: [],
    });
  });

  it("streams text and settles after a prompt", async () => {
    const c = start([{ text: "hello from the engine" }], () => false);
    await init(c);
    const events: EngineStreamEvent[] = [];
    c.onEvent((e) => events.push(e));
    await c.prompt("say hello");
    const text = events
      .filter((e) => e.type === "text_delta")
      .map((e) => (e.type === "text_delta" ? e.text : ""))
      .join("");
    expect(text).toBe("hello from the engine");
    expect(events.at(-1)).toEqual({ type: "settled" });
  });

  it("asks the host for a safe-zone write and runs it when approved", async () => {
    const onApproval = vi.fn(async (_req: ApprovalPrompt) => true);
    const c = start(safeZoneWrite, onApproval);
    await init(c);
    const events: EngineStreamEvent[] = [];
    c.onEvent((e) => events.push(e));
    await c.prompt("edit auth");
    expect(onApproval).toHaveBeenCalledOnce();
    expect(onApproval.mock.calls[0]?.[0]).toMatchObject({
      toolName: "write",
      capability: "edit_workspace",
      paths: ["auth/login.ts"],
    });
    expect(onApproval.mock.calls[0]?.[0].reason).toContain("Safe zone");
    expect(readFileSync(join(workDir, "auth", "login.ts"), "utf8")).toBe("ok");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "audit",
        audit: expect.objectContaining({ decision: "ask", approved: true }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool_end", toolName: "write", isError: false }),
    );
  });

  it("blocks the write when the host denies it", async () => {
    const c = start(safeZoneWrite, () => false);
    await init(c);
    await c.prompt("edit auth");
    expect(existsSync(join(workDir, "auth", "login.ts"))).toBe(false);
    const state = await c.state();
    expect(state.auditLog[0]).toMatchObject({ decision: "ask", approved: false });
  });

  it("denies when the host approval callback throws", async () => {
    const c = start(safeZoneWrite, () => {
      throw new Error("webview gone");
    });
    await init(c);
    await c.prompt("edit auth");
    expect(existsSync(join(workDir, "auth", "login.ts"))).toBe(false);
  });

  it("denies when the host does not answer before the approval timeout", async () => {
    let aborted = false;
    const c = start(
      safeZoneWrite,
      (_req, signal) =>
        new Promise<boolean>((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve(true); // too late: the client already sent a deny
          });
        }),
      { approvalTimeoutMs: 200 },
    );
    await init(c);
    await c.prompt("edit auth");
    expect(aborted).toBe(true);
    expect(existsSync(join(workDir, "auth", "login.ts"))).toBe(false);
    const state = await c.state();
    expect(state.auditLog[0]).toMatchObject({ decision: "ask", approved: false });
  });

  it("rejects a second prompt while one is running", async () => {
    const c = start([], () => false, { mode: "hang_prompt" });
    await init(c);
    const first = c.prompt("one");
    first.catch(() => {});
    await expect(c.prompt("two")).rejects.toThrow(/busy/i);
  });

  it("times out a prompt, then cancels it in the engine", async () => {
    const c = start([], () => false, { mode: "hang_prompt" });
    await init(c);
    await expect(c.prompt("hang", { timeoutMs: 300 })).rejects.toBeInstanceOf(EngineTimeoutError);
    const state = await c.state();
    expect(state.running).toBe(false);
  });

  it("cancels a prompt through an AbortSignal", async () => {
    const c = start([], () => false, { mode: "hang_prompt" });
    await init(c);
    const controller = new AbortController();
    const p = c.prompt("hang", { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await expect(p).rejects.toThrow(/aborted/i);
    expect((await c.state()).running).toBe(false);
  });

  it("rejects pending work and reports the exit when the engine crashes", async () => {
    const c = start([], () => false, { mode: "crash_on_prompt" });
    await init(c);
    const exits: { code: number | null }[] = [];
    c.onExit((info) => exits.push(info));
    const err = await c.prompt("crash").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineExitedError);
    expect((err as EngineExitedError).exitCode).toBe(9);
    expect(exits).toEqual([expect.objectContaining({ code: 9 })]);
    await expect(c.state()).rejects.toBeInstanceOf(EngineExitedError);
  });

  it("streams engine stderr to onStderr listeners as it arrives", async () => {
    const c = start([], () => false, { mode: "stderr_banner" });
    const chunks: string[] = [];
    c.onStderr((text) => chunks.push(text));
    await c.start();
    await vi.waitFor(() => expect(chunks.join("")).toContain("faux engine stderr banner"));
    expect(c.stderr).toContain("faux engine stderr banner");
  });

  it("shuts down cleanly", async () => {
    const c = start([], () => false);
    await init(c);
    const exits: { code: number | null }[] = [];
    c.onExit((info) => exits.push(info));
    await c.stop();
    expect(exits).toEqual([expect.objectContaining({ code: 0 })]);
  });

  it("answers malformed lines with a protocol error and keeps serving", async () => {
    const c = start([], () => false);
    await init(c);
    const errors: string[] = [];
    c.onProtocolError((e) => errors.push(e.code));
    c.writeRawForTest("{not json\n");
    c.writeRawForTest(`${JSON.stringify({ v: 2, type: "request", id: "x", method: "abort" })}\n`);
    c.writeRawForTest(
      `${JSON.stringify({ v: 1, type: "approval_response", id: "nope", approved: true })}\n`,
    );
    expect((await c.state()).initialized).toBe(true);
    await vi.waitFor(() =>
      expect(errors).toEqual(["parse_error", "unsupported_version", "unknown_approval"]),
    );
  });

  it("the real engine entry starts with no network and fails init on an unknown model", async () => {
    const c = start([], () => false, { entry: realEngine });
    await c.start();
    await expect(
      c.init({
        cwd: workDir,
        configDir,
        model: { providerId: "nope", modelId: "missing" },
        policyContext: guidedL2,
      }),
    ).rejects.toThrow(/Unknown model/);
    expect((await c.state()).initialized).toBe(false);
  });

  it("passes only the env allowlist to the child; host keys never arrive (issue #38)", async () => {
    const out = join(workDir, "env.json");
    const fake = ["blame", "fake", "env", "value"].join("-");
    const c = start([], () => false, {
      hostEnv: {
        ...process.env,
        OPENAI_API_KEY: fake,
        ANTHROPIC_API_KEY: fake,
        GITHUB_TOKEN: fake,
        NODE_OPTIONS: "--max-old-space-size=64",
        BLAME_UNLISTED_VAR: "x",
      },
      extraEnv: { BLAME_FAUX_ENV_OUT: out, MY_SERVICE_TOKEN: fake },
    });
    await init(c);
    const report = JSON.parse(readFileSync(out, "utf8")) as {
      received: string[];
      afterScrub: string[];
    };
    for (const name of [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GITHUB_TOKEN",
      "NODE_OPTIONS",
      "BLAME_UNLISTED_VAR",
    ]) {
      expect(report.received).not.toContain(name);
    }
    expect(report.received).toContain("BLAME_FAUX_ENV_OUT");
    // A credential-looking name sent through extraEnv is still scrubbed by the engine.
    expect(report.received).toContain("MY_SERVICE_TOKEN");
    expect(report.afterScrub).not.toContain("MY_SERVICE_TOKEN");
    if (process.env.PATH !== undefined) expect(report.received).toContain("PATH");
  });

  it("delivers an execution_violation audit event from the engine to the client (#40)", async () => {
    const c = start([], () => false, { mode: "rogue_execute_on_prompt" });
    await init(c);
    const events: EngineStreamEvent[] = [];
    c.onEvent((e) => events.push(e));
    const protocolErrors: string[] = [];
    c.onProtocolError((e) => protocolErrors.push(e.code));
    await c.prompt("go");
    expect(events).toContainEqual({
      type: "audit",
      audit: expect.objectContaining({
        type: "execution_violation",
        toolName: "write",
        toolCallId: "rogue-1",
        decision: "block",
      }),
    });
    expect(protocolErrors).toEqual([]);
    expect(existsSync(join(workDir, "src", "rogue.ts"))).toBe(false);
    const state = await c.state();
    expect(state.auditLog).toContainEqual(expect.objectContaining({ type: "execution_violation" }));
  });
});

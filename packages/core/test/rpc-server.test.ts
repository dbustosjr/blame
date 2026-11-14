import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBlameModelRuntime,
  type EngineMessage,
  parseEngineMessage,
  runEngineServer,
} from "../src/index.js";

const policyContext = {
  presetId: "guided",
  earnedLevelId: "L2",
  optedIn: false,
  sandboxAvailable: false,
};

let workDir: string;
let configDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "blame-srv-work-"));
  configDir = mkdtempSync(join(tmpdir(), "blame-srv-config-"));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
});

function harness(options: { maxLineLength?: number; steps?: "safe_zone_write" } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames: EngineMessage[] = [];
  const raw: string[] = [];
  let buffered = "";
  output.on("data", (chunk: Buffer) => {
    buffered += chunk.toString("utf8");
    let nl = buffered.indexOf("\n");
    while (nl !== -1) {
      const line = buffered.slice(0, nl);
      buffered = buffered.slice(nl + 1);
      raw.push(line);
      const parsed = parseEngineMessage(line);
      if (parsed.ok) frames.push(parsed.message);
      nl = buffered.indexOf("\n");
    }
  });
  const faux = fauxProvider();
  if (options.steps === "safe_zone_write") {
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("write", { path: "auth/login.ts", content: "x" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
  }
  const exit = vi.fn();
  const server = runEngineServer({
    input,
    output,
    exit,
    createModelRuntime: async () => {
      const runtime = await createBlameModelRuntime();
      runtime.registerNativeProvider(faux.provider);
      return runtime;
    },
    ...(options.maxLineLength === undefined ? {} : { maxLineLength: options.maxLineLength }),
  });
  const write = (message: unknown) => input.write(`${JSON.stringify(message)}\n`);
  const response = (id: string) =>
    vi.waitFor(() => {
      const r = frames.find((f) => f.type === "response" && f.id === id);
      if (!r) throw new Error(`no response ${id}`);
      return r;
    });
  return { input, frames, raw, exit, server, write, response };
}

const initRequest = (id: string, extra: Record<string, unknown> = {}) => ({
  v: 1,
  type: "request",
  id,
  method: "init",
  params: {
    cwd: workDir,
    configDir,
    model: { providerId: "faux", modelId: "faux-1" },
    policyContext,
    ...extra,
  },
});

describe("runEngineServer", () => {
  it("starts with a ready frame carrying the protocol version", async () => {
    const h = harness();
    await vi.waitFor(() =>
      expect(h.frames[0]).toEqual({ v: 1, type: "ready", protocol: 1, engine: "blame" }),
    );
    h.input.end();
    await h.server.closed;
  });

  it("denies an approval the client never answers, after the engine's timeout", async () => {
    const h = harness({ steps: "safe_zone_write" });
    h.write(initRequest("1", { approvalTimeoutMs: 100 }));
    expect(await h.response("1")).toMatchObject({ ok: true });
    h.write({ v: 1, type: "request", id: "2", method: "prompt", params: { text: "edit auth" } });
    await vi.waitFor(() => expect(h.frames.some((f) => f.type === "approval_request")).toBe(true));
    expect(await h.response("2")).toMatchObject({ ok: true });
    expect(existsSync(join(workDir, "auth", "login.ts"))).toBe(false);
    const audit = h.frames.find((f) => f.type === "event" && f.event.type === "audit");
    expect(audit).toMatchObject({ event: { audit: { decision: "ask", approved: false } } });
    h.input.end();
    await h.server.closed;
  });

  it("denies an open approval when the client closes stdin, and exits 0", async () => {
    const h = harness({ steps: "safe_zone_write" });
    h.write(initRequest("1"));
    await h.response("1");
    h.write({ v: 1, type: "request", id: "2", method: "prompt", params: { text: "edit auth" } });
    await vi.waitFor(() => expect(h.frames.some((f) => f.type === "approval_request")).toBe(true));
    h.input.end();
    await h.server.closed;
    expect(h.exit).toHaveBeenCalledWith(0);
    expect(existsSync(join(workDir, "auth", "login.ts"))).toBe(false);
  });

  it("reports an oversized line and keeps serving", async () => {
    const h = harness({ maxLineLength: 1000 });
    h.input.write(`${"x".repeat(5000)}\n`);
    h.write({ v: 1, type: "request", id: "s", method: "blame_state" });
    expect(await h.response("s")).toMatchObject({ ok: true, result: { initialized: false } });
    expect(h.frames).toContainEqual(
      expect.objectContaining({ type: "protocol_error", code: "line_too_long" }),
    );
    h.input.end();
    await h.server.closed;
  });

  it("answers requests before init with not_initialized", async () => {
    const h = harness();
    h.write({ v: 1, type: "request", id: "p", method: "prompt", params: { text: "hi" } });
    expect(await h.response("p")).toMatchObject({ ok: false, error: { code: "not_initialized" } });
    h.input.end();
    await h.server.closed;
  });

  it("never writes the API key to stdout, even in an init error", async () => {
    const h = harness();
    const key = "sk-blame-test-never-echo-123";
    h.write(initRequest("1", { apiKey: key, model: { providerId: "faux", modelId: key } }));
    expect(await h.response("1")).toMatchObject({ ok: false, error: { code: "init_failed" } });
    h.write({ v: 1, type: "request", id: "s", method: "blame_state" });
    await h.response("s");
    expect(h.raw.join("\n")).not.toContain(key);
    h.input.end();
    await h.server.closed;
  });

  it("rejects a second init", async () => {
    const h = harness();
    h.write(initRequest("1"));
    await h.response("1");
    h.write(initRequest("2"));
    expect(await h.response("2")).toMatchObject({
      ok: false,
      error: { code: "already_initialized" },
    });
    h.input.end();
    await h.server.closed;
  });
});

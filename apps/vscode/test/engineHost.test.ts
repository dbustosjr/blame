import type {
  ApprovalPrompt,
  BlameEngineClientOptions,
  BlameState,
  EngineExitInfo,
  EngineStreamEvent,
  InitParams,
} from "@blame-ai/core/engine-client";
import { describe, expect, it, vi } from "vitest";
import {
  type EngineClientLike,
  EngineHost,
  type EngineHostDeps,
  EngineHostError,
} from "../src/engine/host";

// A low-entropy fake key so secret scanners do not flag it.
const FAKE_KEY = ["sk", "blame", "test", "not", "a", "real", "key"].join("-");

class FakeClient implements EngineClientLike {
  readonly calls: string[] = [];
  initParams: InitParams | undefined;
  readonly events = new Set<(e: EngineStreamEvent) => void>();
  readonly exits = new Set<(i: EngineExitInfo) => void>();
  readonly stderrs = new Set<(t: string) => void>();
  promptImpl: (text: string, signal?: AbortSignal) => Promise<void> = async () => {};
  constructor(readonly options: BlameEngineClientOptions) {}
  async start() {
    this.calls.push("start");
    return { protocol: 1, engine: "blame" };
  }
  async init(params: InitParams) {
    this.calls.push("init");
    this.initParams = params;
  }
  async prompt(text: string, opts: { signal?: AbortSignal } = {}) {
    this.calls.push(`prompt:${text}`);
    await this.promptImpl(text, opts.signal);
  }
  async abort() {
    this.calls.push("abort");
  }
  async state() {
    this.calls.push("state");
    return { initialized: true } as BlameState;
  }
  async stop() {
    this.calls.push("stop");
  }
  onEvent(l: (e: EngineStreamEvent) => void) {
    this.events.add(l);
    return () => this.events.delete(l);
  }
  onExit(l: (i: EngineExitInfo) => void) {
    this.exits.add(l);
    return () => this.exits.delete(l);
  }
  onStderr(l: (t: string) => void) {
    this.stderrs.add(l);
    return () => this.stderrs.delete(l);
  }
  emit(e: EngineStreamEvent) {
    for (const l of this.events) l(e);
  }
  crash(info: EngineExitInfo) {
    for (const l of this.exits) l(info);
  }
  writeStderr(t: string) {
    for (const l of this.stderrs) l(t);
  }
}

function setup(overrides: Partial<EngineHostDeps> = {}) {
  const clients: FakeClient[] = [];
  const logs: string[] = [];
  const transcript: string[] = [];
  const deps: EngineHostDeps = {
    entry: "/ext/dist/engine.mjs",
    configDir: "/global/blame",
    createClient: (options) => {
      const c = new FakeClient(options);
      clients.push(c);
      return c;
    },
    getApiKey: async () => FAKE_KEY,
    getSettings: () => ({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-5",
      presetId: "guided",
    }),
    getWorkspace: () => ({ cwd: "/repo", trusted: true }),
    presentApproval: async () => false,
    log: {
      info: (m) => logs.push(`info ${m}`),
      warn: (m) => logs.push(`warn ${m}`),
      error: (m) => logs.push(`error ${m}`),
    },
    transcript: { append: (t) => transcript.push(t) },
    ...overrides,
  };
  return { host: new EngineHost(deps), clients, logs, transcript, deps };
}

const approvalReq: ApprovalPrompt = {
  id: "a1",
  toolName: "bash",
  toolCallId: "t1",
  capability: "run_any",
  paths: [],
  reason: "shell commands always ask",
  timeoutMs: 1000,
};

describe("EngineHost", () => {
  it("spawns the bundled entry explicitly and sends the key only in init", async () => {
    const { host, clients } = setup();
    await host.prompt("fix the bug");
    const c = clients[0];
    expect(c?.options.entry).toBe("/ext/dist/engine.mjs");
    expect(c?.options.cwd).toBe("/repo");
    expect(JSON.stringify(c?.options.extraEnv ?? {})).not.toContain(FAKE_KEY);
    expect(JSON.stringify(c?.options.args ?? [])).not.toContain(FAKE_KEY);
    expect(c?.initParams).toMatchObject({
      cwd: "/repo",
      configDir: "/global/blame",
      model: { providerId: "anthropic", modelId: "claude-sonnet-4-5" },
      apiKey: FAKE_KEY,
    });
    expect(c?.calls).toEqual(["start", "init", "prompt:fix the bug"]);
  });

  it("reuses one engine across prompts", async () => {
    const { host, clients } = setup();
    await host.prompt("one");
    await host.prompt("two");
    expect(clients).toHaveLength(1);
  });

  it("never auto-allows shell: Autonomous still runs with no opt-in and no sandbox (issue #26)", async () => {
    const { host, clients } = setup({
      getSettings: () => ({ providerId: "anthropic", modelId: "m", presetId: "autonomous" }),
    });
    await host.prompt("go");
    expect(clients[0]?.initParams?.policyContext).toMatchObject({
      presetId: "autonomous",
      optedIn: false,
      sandboxAvailable: false,
    });
  });

  it("refuses to start without a trusted workspace, a model, or a key", async () => {
    await expect(setup({ getWorkspace: () => undefined }).host.prompt("x")).rejects.toMatchObject({
      code: "no_workspace",
    });
    await expect(
      setup({ getWorkspace: () => ({ cwd: "/repo", trusted: false }) }).host.prompt("x"),
    ).rejects.toMatchObject({ code: "untrusted_workspace" });
    await expect(
      setup({
        getSettings: () => ({ providerId: "anthropic", modelId: "", presetId: "guided" }),
      }).host.prompt("x"),
    ).rejects.toMatchObject({ code: "no_model" });
    const noKey = setup({ getApiKey: async () => undefined });
    await expect(noKey.host.prompt("x")).rejects.toBeInstanceOf(EngineHostError);
    await expect(noKey.host.prompt("x")).rejects.toMatchObject({ code: "no_key" });
    expect(noKey.clients).toHaveLength(0);
  });

  it("approves only when the presenter resolves true", async () => {
    const present = vi.fn(async () => true);
    const { host, clients } = setup({ presentApproval: present });
    await host.prompt("x");
    const onApproval = clients[0]?.options.onApproval;
    expect(await onApproval?.(approvalReq, new AbortController().signal)).toBe(true);
    expect(present).toHaveBeenCalledWith(approvalReq, expect.any(AbortSignal));
  });

  it("fails closed: a dismissed dialog, a throw, or an aborted request all deny", async () => {
    const answers: Array<() => Promise<boolean>> = [
      async () => false,
      async () => {
        throw new Error("dialog broke");
      },
      async () => undefined as unknown as boolean,
    ];
    for (const answer of answers) {
      const { host, clients, logs } = setup({ presentApproval: answer });
      await host.prompt("x");
      expect(await clients[0]?.options.onApproval(approvalReq, new AbortController().signal)).toBe(
        false,
      );
      if (logs.some((l) => l.includes("dialog broke"))) expect(logs.join()).toContain("denied");
    }
    const late = setup({ presentApproval: async () => true });
    await late.host.prompt("x");
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await late.clients[0]?.options.onApproval(approvalReq, ctrl.signal)).toBe(false);
  });

  it("passes the host approval timeout to the client", async () => {
    const { host, clients } = setup({ approvalTimeoutMs: 1234 });
    await host.prompt("x");
    expect(clients[0]?.options.approvalTimeoutMs).toBe(1234);
  });

  it("streams text to the transcript and redacts the key everywhere it shows", async () => {
    const { host, clients, logs, transcript } = setup();
    clients.length = 0;
    const done = host.prompt("x");
    await vi.waitFor(() => expect(clients[0]?.calls).toContain("init"));
    const c = clients[0] as FakeClient;
    c.emit({ type: "text_delta", text: `hello ${FAKE_KEY}` });
    c.writeStderr(`boom with ${FAKE_KEY}\n`);
    c.emit({ type: "error", message: `bad ${FAKE_KEY}` });
    await done;
    const shown = [...logs, ...transcript].join("\n");
    expect(shown).not.toContain(FAKE_KEY);
    expect(transcript.join("")).toContain("hello [redacted]");
    expect(logs.join("\n")).toContain("boom with [redacted]");
  });

  it("reports a crash with redacted stderr and starts a fresh engine next time", async () => {
    const { host, clients, logs } = setup();
    await host.prompt("x");
    const c = clients[0] as FakeClient;
    c.writeStderr(`trace ${FAKE_KEY}`);
    c.crash({ code: 9, signal: null });
    expect(logs.join("\n")).toMatch(/error Blame engine exited \(code 9/);
    expect(logs.join("\n")).not.toContain(FAKE_KEY);
    expect(host.running).toBe(false);
    await host.prompt("again");
    expect(clients).toHaveLength(2);
  });

  it("aborts the running prompt", async () => {
    const { host, clients } = setup();
    let release: () => void = () => {};
    const done = host.prompt("long");
    await vi.waitFor(() => expect(clients[0]).toBeDefined());
    const c = clients[0] as FakeClient;
    c.promptImpl = () => new Promise<void>((r) => (release = r));
    await done;
    const second = host.prompt("longer");
    await vi.waitFor(() => expect(c.calls).toContain("prompt:longer"));
    expect(host.busy).toBe(true);
    await host.abort();
    expect(c.calls).toContain("abort");
    release();
    await second;
    expect(host.busy).toBe(false);
  });

  it("abort with no engine does nothing", async () => {
    const { host, clients } = setup();
    await host.abort();
    expect(clients).toHaveLength(0);
  });

  it("dispose shuts the engine down and does not report the exit as a crash", async () => {
    const { host, clients, logs } = setup();
    await host.prompt("x");
    const c = clients[0] as FakeClient;
    await host.dispose();
    c.crash({ code: 0, signal: null });
    expect(c.calls.at(-1)).toBe("stop");
    expect(logs.join("\n")).not.toMatch(/error Blame engine exited/);
    await expect(host.prompt("after")).rejects.toMatchObject({ code: "disposed" });
  });

  it("stops the engine if init fails, without leaking the key in the error", async () => {
    const { host, clients, logs } = setup({
      createClient: (options) => {
        const c = new FakeClient(options);
        c.init = async () => {
          throw new Error(`unknown model, key ${FAKE_KEY}`);
        };
        clients.push(c);
        return c;
      },
    });
    const err = await host.prompt("x").catch((e: unknown) => e as Error);
    expect(String(err)).not.toContain(FAKE_KEY);
    expect(clients[0]?.calls).toContain("stop");
    expect(logs.join("\n")).not.toContain(FAKE_KEY);
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEngineEnv,
  createBlameModelRuntime,
  createStreamRedactor,
  DEFAULT_AUDIT_LOG_LIMIT,
  type EngineMessage,
  parseEngineMessage,
  runEngineServer,
  scrubEngineEnv,
} from "../src/index.js";

// Fake values only. Low entropy on purpose (gitleaks).
const FAKE_SECRET = ["blame", "fake", "provider", "value"].join("-");

describe("buildEngineEnv (issue #38 item 1)", () => {
  const host = {
    PATH: "/usr/bin",
    HOME: "/home/u",
    LANG: "en_US.UTF-8",
    LC_ALL: "C",
    TMPDIR: "/tmp",
    OPENAI_API_KEY: FAKE_SECRET,
    ANTHROPIC_API_KEY: FAKE_SECRET,
    GITHUB_TOKEN: FAKE_SECRET,
    AWS_SECRET_ACCESS_KEY: FAKE_SECRET,
    NODE_OPTIONS: "--require /evil.js",
    ELECTRON_RUN_AS_NODE: "1",
  };

  it("passes only the allowlist on POSIX", () => {
    expect(buildEngineEnv(host, { platform: "linux" })).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/u",
      LANG: "en_US.UTF-8",
      LC_ALL: "C",
      TMPDIR: "/tmp",
    });
  });

  it("keeps Windows names in their original case and adds the Windows system vars", () => {
    const env = buildEngineEnv(
      {
        Path: "C:\\Windows",
        USERPROFILE: "C:\\Users\\d",
        TEMP: "C:\\t",
        TMP: "C:\\t",
        SystemRoot: "C:\\Windows",
        windir: "C:\\Windows",
        ComSpec: "C:\\Windows\\system32\\cmd.exe",
        OPENAI_API_KEY: FAKE_SECRET,
      },
      { platform: "win32" },
    );
    expect(env).toEqual({
      Path: "C:\\Windows",
      USERPROFILE: "C:\\Users\\d",
      TEMP: "C:\\t",
      TMP: "C:\\t",
      SystemRoot: "C:\\Windows",
      windir: "C:\\Windows",
      ComSpec: "C:\\Windows\\system32\\cmd.exe",
    });
  });

  it("does not pass Windows-only vars on POSIX", () => {
    expect(buildEngineEnv({ SystemRoot: "x", COMSPEC: "y" }, { platform: "darwin" })).toEqual({});
  });

  it("adds host-supplied extraEnv explicitly", () => {
    expect(
      buildEngineEnv({ PATH: "/b" }, { platform: "linux", extraEnv: { BLAME_LOG: "debug" } }),
    ).toEqual({
      PATH: "/b",
      BLAME_LOG: "debug",
    });
  });
});

describe("scrubEngineEnv (engine side: Pi falls back to env keys)", () => {
  it("guards the premise: Pi 1.5.2 resolves a provider key from the environment", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = FAKE_SECRET;
    try {
      const runtime = await createBlameModelRuntime();
      const auth = await runtime.getAuth("anthropic");
      expect(JSON.stringify(auth)).toContain(FAKE_SECRET);
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it("removes credential-looking vars so Pi has nothing to fall back to", () => {
    const env: Record<string, string | undefined> = {
      PATH: "/b",
      OPENAI_API_KEY: FAKE_SECRET,
      ANTHROPIC_AUTH_TOKEN: FAKE_SECRET,
      ANTHROPIC_OAUTH_TOKEN: FAKE_SECRET,
      GITHUB_TOKEN: FAKE_SECRET,
      GH_TOKEN: FAKE_SECRET,
      AWS_SECRET_ACCESS_KEY: FAKE_SECRET,
      AWS_PROFILE: "p",
      GOOGLE_APPLICATION_CREDENTIALS: "/x.json",
      AZURE_OPENAI_API_KEY: FAKE_SECRET,
      MY_SERVICE_SECRET: FAKE_SECRET,
      BLAME_LOG: "debug",
    };
    const removed = scrubEngineEnv(env);
    expect(env).toEqual({ PATH: "/b", BLAME_LOG: "debug" });
    expect(removed).toContain("OPENAI_API_KEY");
  });

  it("after scrubbing, Blame's runtime has no anthropic auth from env", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = FAKE_SECRET;
    try {
      scrubEngineEnv(process.env);
      const runtime = await createBlameModelRuntime();
      expect(await runtime.getAuth("anthropic")).toBeUndefined();
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

describe("createStreamRedactor (issue #38 item 2)", () => {
  it("redacts a secret split across many deltas", () => {
    const r = createStreamRedactor([FAKE_SECRET]);
    const text = `before ${FAKE_SECRET} after`;
    let out = "";
    for (const ch of text) out += r.push(ch);
    out += r.flush();
    expect(out).toBe("before [redacted] after");
  });

  it("passes text through unchanged when nothing matches, holding back only a possible prefix", () => {
    const r = createStreamRedactor([FAKE_SECRET]);
    expect(r.push("hello bla")).toBe("hello ");
    expect(r.push("ck")).toBe("black");
    expect(r.flush()).toBe("");
  });

  it("does nothing without secrets", () => {
    const r = createStreamRedactor([]);
    expect(r.push("abc")).toBe("abc");
  });
});

let workDir: string;
let configDir: string;
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "blame-hard-work-"));
  configDir = mkdtempSync(join(tmpdir(), "blame-hard-config-"));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
});

function harness(responses: ReturnType<typeof fauxAssistantMessage>[], auditLogLimit?: number) {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames: EngineMessage[] = [];
  const raw: string[] = [];
  let buffered = "";
  output.on("data", (chunk: Buffer) => {
    buffered += chunk.toString("utf8");
    for (let nl = buffered.indexOf("\n"); nl !== -1; nl = buffered.indexOf("\n")) {
      const line = buffered.slice(0, nl);
      buffered = buffered.slice(nl + 1);
      raw.push(line);
      const parsed = parseEngineMessage(line);
      if (parsed.ok) frames.push(parsed.message);
    }
  });
  const faux = fauxProvider();
  faux.setResponses(responses);
  const server = runEngineServer({
    input,
    output,
    exit: () => {},
    createModelRuntime: async () => {
      const runtime = await createBlameModelRuntime();
      runtime.registerNativeProvider(faux.provider);
      return runtime;
    },
    ...(auditLogLimit === undefined ? {} : { auditLogLimit }),
  });
  const write = (m: unknown) => input.write(`${JSON.stringify(m)}\n`);
  const response = (id: string) =>
    vi.waitFor(
      () => {
        const r = frames.find((f) => f.type === "response" && f.id === id);
        if (!r) throw new Error(`no response ${id}`);
        return r;
      },
      { timeout: 10_000 },
    );
  const init = async (extra: Record<string, unknown> = {}) => {
    write({
      v: 1,
      type: "request",
      id: "init",
      method: "init",
      params: {
        cwd: workDir,
        configDir,
        model: { providerId: "faux", modelId: "faux-1" },
        policyContext: {
          presetId: "guided",
          earnedLevelId: "L2",
          optedIn: false,
          sandboxAvailable: false,
        },
        approvalTimeoutMs: 20,
        ...extra,
      },
    });
    expect(await response("init")).toMatchObject({ ok: true });
  };
  return { input, frames, raw, server, write, response, init };
}

const toolTurn = (path: string) =>
  fauxAssistantMessage(fauxToolCall("write", { path, content: "x" }), { stopReason: "toolUse" });

describe("engine redaction of every output (issue #38 item 2)", () => {
  it("never writes the key to stdout when the model echoes it in text and tool input", async () => {
    const h = harness([
      toolTurn(`auth/${FAKE_SECRET}.ts`),
      fauxAssistantMessage(`Your key is ${FAKE_SECRET}, right? ${FAKE_SECRET}`),
    ]);
    await h.init({ apiKey: FAKE_SECRET });
    h.write({ v: 1, type: "request", id: "p", method: "prompt", params: { text: "leak it" } });
    expect(await h.response("p")).toMatchObject({ ok: true });
    h.write({ v: 1, type: "request", id: "s", method: "blame_state" });
    await h.response("s");

    const types = new Set(h.frames.map((f) => (f.type === "event" ? f.event.type : f.type)));
    for (const t of ["text_delta", "audit", "approval_request", "response", "settled"]) {
      expect(types).toContain(t);
    }
    expect(h.raw.join("\n")).not.toContain(FAKE_SECRET);
    const text = h.frames
      .map((f) => (f.type === "event" && f.event.type === "text_delta" ? f.event.text : ""))
      .join("");
    expect(text).toContain("Your key is [redacted], right? [redacted]");
    h.input.end();
    await h.server.closed;
  });
});

describe("bounded audit log (issue #38 item 3)", () => {
  it("defaults to 1000 entries", () => {
    expect(DEFAULT_AUDIT_LOG_LIMIT).toBe(1000);
  });

  it("keeps only the most recent entries in a long session", async () => {
    const turns = Array.from({ length: 8 }, (_, i) => toolTurn(`auth/f${i}.ts`));
    const h = harness([...turns, fauxAssistantMessage("done")], 3);
    await h.init();
    h.write({ v: 1, type: "request", id: "p", method: "prompt", params: { text: "many" } });
    expect(await h.response("p")).toMatchObject({ ok: true });
    h.write({ v: 1, type: "request", id: "s", method: "blame_state" });
    const state = (await h.response("s")) as {
      result: { auditLog: { paths: string[] }[]; auditLogTotal: number };
    };
    expect(state.result.auditLog.map((a) => a.paths[0])).toEqual([
      "auth/f5.ts",
      "auth/f6.ts",
      "auth/f7.ts",
    ]);
    expect(state.result.auditLogTotal).toBe(8);
    h.input.end();
    await h.server.closed;
  }, 30_000);
});

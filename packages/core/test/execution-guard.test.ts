import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type FauxProviderHandle,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AnyToolDefinition,
  type AuditEvent,
  type BlameSession,
  createBlameModelRuntime,
  createBlameSession,
  createExecutionLedger,
  guardTool,
  type PolicyContext,
} from "../src/index.js";

const guidedL2: PolicyContext = {
  presetId: "guided",
  earnedLevelId: "L2",
  optedIn: false,
  sandboxAvailable: false,
};

let workDir: string;
let configDir: string;
let faux: FauxProviderHandle;
let session: BlameSession | undefined;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "blame-guard-work-"));
  configDir = mkdtempSync(join(tmpdir(), "blame-guard-config-"));
  faux = fauxProvider();
});
afterEach(() => {
  session?.dispose();
  session = undefined;
  rmSync(workDir, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
});

async function start(extra: Partial<Parameters<typeof createBlameSession>[0]> = {}) {
  const modelRuntime = await createBlameModelRuntime();
  modelRuntime.registerNativeProvider(faux.provider);
  session = await createBlameSession({
    cwd: workDir,
    configDir,
    model: { providerId: "faux", modelId: "faux-1" },
    policyContext: guidedL2,
    modelRuntime,
    ...extra,
  });
  return session;
}

const violations = (log: readonly AuditEvent[]) =>
  log.filter((e) => e.type === "execution_violation");

describe("T-19 execution guard in createBlameSession", () => {
  it("gates each of several parallel tool calls in one message", async () => {
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("write", { path: "src/a.ts", content: "a" }, { id: "call-a" }),
          fauxToolCall("write", { path: "auth/b.ts", content: "b" }, { id: "call-b" }),
          fauxToolCall("write", { path: "src/c.ts", content: "c" }, { id: "call-c" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    const s = await start();
    await s.prompt("three writes");
    expect(readFileSync(join(workDir, "src", "a.ts"), "utf8")).toBe("a");
    expect(readFileSync(join(workDir, "src", "c.ts"), "utf8")).toBe("c");
    expect(existsSync(join(workDir, "auth", "b.ts"))).toBe(false);
    expect(s.auditLog).toEqual([
      expect.objectContaining({ type: "tool_decision", toolCallId: "call-b", approved: false }),
    ]);
    expect(violations(s.auditLog)).toEqual([]);
  });

  it("blocks a tool call whose gate throws (policy context failure)", async () => {
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("write", { path: "src/a.ts", content: "a" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    const s = await start({
      policyContext: () => {
        throw new Error("policy store unreadable");
      },
    });
    await s.prompt("write");
    expect(existsSync(join(workDir, "src", "a.ts"))).toBe(false);
    expect(s.auditLog[0]).toMatchObject({ decision: "block" });
    expect(s.auditLog[0]?.reason).toContain("Policy error");
  });

  it("blocks and records an execution of a registered tool with no gate decision", async () => {
    const s = await start();
    const write = s.pi.agent.state.tools.find((t) => t.name === "write");
    expect(write).toBeDefined();
    const result = await write
      ?.execute("rogue-1", { path: "src/rogue.ts", content: "x" }, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(result).toBeInstanceOf(Error);
    expect(existsSync(join(workDir, "src", "rogue.ts"))).toBe(false);
    expect(violations(s.auditLog)).toEqual([
      expect.objectContaining({ toolName: "write", toolCallId: "rogue-1", decision: "block" }),
    ]);
  });

  it("wraps every tool Blame turns on, including the secret-safe search tools", async () => {
    const s = await start({ tools: ["read", "bash", "edit", "write", "grep", "find", "ls"] });
    for (const tool of s.pi.agent.state.tools) {
      const r = await tool
        .execute(`rogue-${tool.name}`, {}, new AbortController().signal)
        .catch((e: unknown) => e);
      expect(r, tool.name).toBeInstanceOf(Error);
    }
    expect(
      violations(s.auditLog)
        .map((v) => v.toolName)
        .sort(),
    ).toEqual(["bash", "edit", "find", "grep", "ls", "read", "write"]);
  });
});

describe("T-19 guardTool and the execution ledger", () => {
  const inner = (): AnyToolDefinition =>
    ({
      name: "write",
      label: "write",
      description: "d",
      parameters: {},
      execute: vi.fn(async () => ({ content: [{ type: "text", text: "ok" }], details: {} })),
    }) as unknown as AnyToolDefinition;

  it("runs once per allowed decision and blocks a replay of the same call id", async () => {
    const onViolation = vi.fn();
    const ledger = createExecutionLedger(onViolation);
    const def = inner();
    const guarded = guardTool(def, ledger);
    const args = { path: "a", content: "b" };
    ledger.allow("c1", "write", args);
    const signal = new AbortController().signal;
    await guarded.execute("c1", args, signal, undefined, undefined as never);
    await expect(
      guarded.execute("c1", args, signal, undefined, undefined as never),
    ).rejects.toThrow(/no matching policy decision/);
    expect(def.execute).toHaveBeenCalledOnce();
    expect(onViolation).toHaveBeenCalledOnce();
  });

  it("blocks when the input changed after the gate decided (TOCTOU)", async () => {
    const onViolation = vi.fn();
    const ledger = createExecutionLedger(onViolation);
    const def = inner();
    ledger.allow("c1", "write", { path: "src/a.ts", content: "x" });
    await expect(
      guardTool(def, ledger).execute(
        "c1",
        { path: "auth/a.ts", content: "x" },
        new AbortController().signal,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow(/changed after/);
    expect(def.execute).not.toHaveBeenCalled();
    expect(onViolation).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: "c1" }));
  });

  it("blocks when the decision was for a different tool", async () => {
    const ledger = createExecutionLedger(vi.fn());
    ledger.allow("c1", "read", { path: "a" });
    await expect(
      guardTool(inner(), ledger).execute(
        "c1",
        { path: "a" },
        new AbortController().signal,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow(/no matching policy decision/);
  });

  it("flags a successful tool_execution_end the gate never saw", () => {
    const onViolation = vi.fn();
    const ledger = createExecutionLedger(onViolation);
    ledger.allow("seen", "read", {});
    ledger.executionEnded("seen", "read", false);
    ledger.executionEnded("failed-unknown-tool", "nope", true);
    expect(onViolation).not.toHaveBeenCalled();
    ledger.executionEnded("never-seen", "bash", false);
    expect(onViolation).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: "never-seen", toolName: "bash" }),
    );
  });
});

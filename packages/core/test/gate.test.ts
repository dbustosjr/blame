import { describe, expect, it, vi } from "vitest";
import {
  type AuditEvent,
  classifyToolCall,
  createAutonomyGate,
  defaultPolicy,
  type PolicyContext,
} from "../src/index.js";

const cwd = process.platform === "win32" ? "C:\\work\\repo" : "/work/repo";
const guidedL2: PolicyContext = {
  presetId: "guided",
  earnedLevelId: "L2",
  optedIn: false,
  sandboxAvailable: false,
};

describe("classifyToolCall", () => {
  it("maps read-only tools to the read capability with repo-relative paths", () => {
    expect(classifyToolCall("read", { path: "src/a.ts" }, cwd)).toEqual({
      capability: "read",
      paths: ["src/a.ts"],
    });
    expect(classifyToolCall("ls", {}, cwd)).toEqual({ capability: "read", paths: [] });
  });

  it("maps edit and write to edit_workspace and normalizes absolute paths", () => {
    const abs = process.platform === "win32" ? `${cwd}\\auth\\login.ts` : `${cwd}/auth/login.ts`;
    expect(classifyToolCall("write", { path: abs, content: "x" }, cwd)).toEqual({
      capability: "edit_workspace",
      paths: ["auth/login.ts"],
    });
    expect(classifyToolCall("edit", { path: "src/b.ts", edits: [] }, cwd)).toEqual({
      capability: "edit_workspace",
      paths: ["src/b.ts"],
    });
  });

  it("tags CI and dependency files with their own capability", () => {
    expect(classifyToolCall("write", { path: ".github/workflows/ci.yml" }, cwd)).toEqual({
      capability: "edit_ci",
      paths: [".github/workflows/ci.yml"],
      riskyClass: "ci_change",
    });
    expect(classifyToolCall("edit", { path: "packages/core/package.json" }, cwd)).toEqual({
      capability: "edit_deps",
      paths: ["packages/core/package.json"],
    });
  });

  it("marks edits outside the workspace as risky", () => {
    expect(classifyToolCall("write", { path: "../other/x.ts" }, cwd)).toMatchObject({
      capability: "edit_workspace",
      riskyClass: "path_outside_workspace",
    });
  });

  it("treats every shell command as risky until the Phase 2 classifier lands", () => {
    expect(classifyToolCall("bash", { command: "ls" }, cwd)).toEqual({
      capability: "run_allowlisted",
      riskyClass: "unclassified_command",
    });
    expect(classifyToolCall("powershell", { command: "dir" }, cwd)).toMatchObject({
      riskyClass: "unclassified_command",
    });
  });

  it("maps unknown tools to an unknown capability so the policy blocks them", () => {
    expect(classifyToolCall("mystery", {}, cwd)).toEqual({ capability: "tool:mystery" });
  });
});

describe("createAutonomyGate", () => {
  const call = (toolName: string, input: Record<string, unknown>) => ({
    toolName,
    toolCallId: `${toolName}-1`,
    input,
  });

  it("allows what the effective level grants and records nothing", async () => {
    const audit: AuditEvent[] = [];
    const gate = createAutonomyGate({
      policy: defaultPolicy,
      cwd,
      policyContext: guidedL2,
      onAudit: (e) => audit.push(e),
    });
    expect(await gate(call("write", { path: "src/a.ts" }))).toBeUndefined();
    expect(audit).toEqual([]);
  });

  it("uses min(preset ceiling, earned level): L0 earned under Guided asks before edits", async () => {
    const approve = vi.fn(async () => false);
    const audit: AuditEvent[] = [];
    const gate = createAutonomyGate({
      policy: defaultPolicy,
      cwd,
      policyContext: { ...guidedL2, earnedLevelId: "L0" },
      approve,
      onAudit: (e) => audit.push(e),
    });
    const result = await gate(call("write", { path: "src/a.ts" }));
    expect(result).toMatchObject({ block: true });
    expect(approve).toHaveBeenCalledOnce();
    expect(audit[0]).toMatchObject({
      type: "tool_decision",
      toolName: "write",
      decision: "ask",
      approved: false,
      effectiveLevelId: "L0",
    });
  });

  it("always asks for safe zones and fails closed without an approver", async () => {
    const audit: AuditEvent[] = [];
    const gate = createAutonomyGate({
      policy: defaultPolicy,
      cwd,
      policyContext: guidedL2,
      onAudit: (e) => audit.push(e),
    });
    const result = await gate(call("write", { path: "auth/login.ts" }));
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("Safe zone");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ decision: "ask", approved: false });
  });

  it("runs an asked call when the approver says yes and records the approval", async () => {
    const audit: AuditEvent[] = [];
    const approve = vi.fn(async () => true);
    const gate = createAutonomyGate({
      policy: defaultPolicy,
      cwd,
      policyContext: guidedL2,
      approve,
      onAudit: (e) => audit.push(e),
    });
    expect(await gate(call("write", { path: "auth/login.ts" }))).toBeUndefined();
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "write",
        action: { capability: "edit_workspace", paths: ["auth/login.ts"] },
        result: expect.objectContaining({ decision: "ask" }),
      }),
    );
    expect(audit[0]).toMatchObject({ decision: "ask", approved: true });
  });

  it("asks for risky classes even when the level allows them (alwaysAskRisky)", async () => {
    const approve = vi.fn(async () => false);
    const gate = createAutonomyGate({
      policy: defaultPolicy,
      cwd,
      policyContext: guidedL2,
      approve,
    });
    expect((await gate(call("bash", { command: "ls" })))?.block).toBe(true);
    expect(approve).toHaveBeenCalledOnce();
  });

  it("blocks without asking when the policy blocks", async () => {
    const approve = vi.fn(async () => true);
    const audit: AuditEvent[] = [];
    const gate = createAutonomyGate({
      policy: defaultPolicy,
      cwd,
      policyContext: { ...guidedL2, presetId: "autonomous" },
      approve,
      onAudit: (e) => audit.push(e),
    });
    const result = await gate(call("read", { path: "src/a.ts" }));
    expect(result).toEqual({
      block: true,
      reason: "Autonomous needs an explicit opt-in for this workspace",
    });
    expect(approve).not.toHaveBeenCalled();
    expect(audit[0]).toMatchObject({ decision: "block" });
  });

  it("blocks unknown tools", async () => {
    const gate = createAutonomyGate({ policy: defaultPolicy, cwd, policyContext: guidedL2 });
    expect(await gate(call("mystery", {}))).toEqual({
      block: true,
      reason: "Unknown capability tool:mystery",
    });
  });

  it("reads the policy context on every call so preset changes apply without restart", async () => {
    let context = guidedL2;
    const gate = createAutonomyGate({
      policy: defaultPolicy,
      cwd,
      policyContext: () => context,
    });
    expect(await gate(call("write", { path: "src/a.ts" }))).toBeUndefined();
    context = { ...guidedL2, presetId: "manual" };
    expect((await gate(call("write", { path: "src/a.ts" })))?.block).toBe(true);
  });

  it("fails closed when the approver throws", async () => {
    const audit: AuditEvent[] = [];
    const gate = createAutonomyGate({
      policy: defaultPolicy,
      cwd,
      policyContext: guidedL2,
      approve: async () => {
        throw new Error("dialog crashed");
      },
      onAudit: (e) => audit.push(e),
    });
    const result = await gate(call("write", { path: "auth/login.ts" }));
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("dialog crashed");
    expect(audit[0]).toMatchObject({ approved: false });
  });
});

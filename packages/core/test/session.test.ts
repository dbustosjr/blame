import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
  type AuditEvent,
  BLAME_SYSTEM_PROMPT,
  type BlameSession,
  createBlameModelRuntime,
  createBlameSession,
  type PolicyContext,
} from "../src/index.js";

const guidedL2: PolicyContext = {
  presetId: "guided",
  earnedLevelId: "L2",
  optedIn: false,
  sandboxAvailable: false,
};

const FAKE_KEY = "sk-blame-test-not-a-real-key";

let workDir: string;
let configDir: string;
let faux: FauxProviderHandle;
let session: BlameSession | undefined;

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
}

async function start(
  extra: Partial<Parameters<typeof createBlameSession>[0]> = {},
): Promise<BlameSession> {
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

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "blame-work-"));
  configDir = mkdtempSync(join(tmpdir(), "blame-config-"));
  faux = fauxProvider();
});

afterEach(() => {
  session?.dispose();
  session = undefined;
  rmSync(workDir, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
});

describe("createBlameSession", () => {
  it("streams the reply from the selected BYOK model", async () => {
    faux.setResponses([fauxAssistantMessage("hello from Blame")]);
    const s = await start({ apiKey: FAKE_KEY });
    let streamed = "";
    s.pi.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        streamed += event.assistantMessageEvent.delta;
      }
    });
    await s.prompt("say hello");
    expect(streamed).toBe("hello from Blame");
    expect(s.pi.getLastAssistantText()).toBe("hello from Blame");
    expect(s.pi.model?.provider).toBe("faux");
  });

  it("keeps the BYOK key in memory and writes no auth.json or key to disk", async () => {
    faux.setResponses([fauxAssistantMessage("ok")]);
    const s = await start({ apiKey: FAKE_KEY });
    await s.prompt("hi");
    expect(await s.modelRuntime.listCredentials()).toContainEqual({
      providerId: "faux",
      type: "api_key",
    });
    for (const file of [...filesUnder(configDir), ...filesUnder(workDir)]) {
      expect(file.endsWith("auth.json")).toBe(false);
      expect(readFileSync(file, "utf8")).not.toContain(FAKE_KEY);
    }
  });

  it("adds the Blame system prompt and injects context as one labeled message", async () => {
    let seen = "";
    faux.setResponses([
      (context) => {
        seen = JSON.stringify(context.messages);
        return fauxAssistantMessage("ok");
      },
    ]);
    const getContext = vi.fn(async () => "Lesson: run the failing test before editing source.");
    const s = await start({ getContext, systemPrompt: { append: ["Project rule: be brief."] } });
    await s.prompt("fix the bug");
    expect(getContext).toHaveBeenCalledWith("fix the bug");
    expect(seen).toContain(JSON.stringify(BLAME_SYSTEM_PROMPT).slice(1, 40));
    expect(seen).toContain("Project rule: be brief.");
    expect(seen).toContain("Lesson: run the failing test before editing source.");
    const injected = s.pi.messages.filter(
      (m) => m.role === "custom" && "customType" in m && m.customType === "blame-context",
    );
    expect(injected).toHaveLength(1);
  });

  it("lets an allowed tool call run", async () => {
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("write", { path: "src/a.ts", content: "export {};\n" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    const s = await start();
    await s.prompt("write a file");
    expect(readFileSync(join(workDir, "src", "a.ts"), "utf8")).toBe("export {};\n");
    expect(s.auditLog).toEqual([]);
  });

  it("blocks a safe-zone write with no approver and records it in the audit log", async () => {
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("write", { path: "auth/login.ts", content: "x" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("blocked"),
    ]);
    const audit: AuditEvent[] = [];
    const s = await start({ onAudit: (e) => audit.push(e) });
    await s.prompt("edit auth");
    expect(existsSync(join(workDir, "auth", "login.ts"))).toBe(false);
    expect(s.auditLog).toHaveLength(1);
    expect(s.auditLog[0]).toMatchObject({
      type: "tool_decision",
      toolName: "write",
      decision: "ask",
      approved: false,
      paths: ["auth/login.ts"],
    });
    expect(s.auditLog[0]?.reason).toContain("Safe zone");
    expect(audit).toEqual(s.auditLog);
  });

  it("runs a safe-zone write after the host approves it", async () => {
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("write", { path: "auth/login.ts", content: "ok" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    const approve = vi.fn(async () => true);
    const s = await start({ approve });
    await s.prompt("edit auth");
    expect(approve).toHaveBeenCalledOnce();
    expect(readFileSync(join(workDir, "auth", "login.ts"), "utf8")).toBe("ok");
    expect(s.auditLog[0]).toMatchObject({ decision: "ask", approved: true });
  });

  it("does not load Pi extensions or settings from the user's ~/.pi", async () => {
    faux.setResponses([fauxAssistantMessage("ok")]);
    const s = await start();
    await s.prompt("hi");
    expect(s.extensionErrors).toEqual([]);
    expect(s.pi.getActiveToolNames().sort()).toEqual(["bash", "edit", "read", "write"]);
  });
});

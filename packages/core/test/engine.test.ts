import { describe, expect, it } from "vitest";
import {
  createStubEngine,
  defaultPolicy,
  type EngineEvent,
  evaluate,
  PI_PACKAGES,
  type PolicyContext,
} from "../src/index.js";

const policyContext: PolicyContext = {
  presetId: "guided",
  earnedLevelId: "L2",
  optedIn: false,
  sandboxAvailable: false,
};

describe("stub engine", () => {
  it("streams a reply and ends the turn", async () => {
    const engine = createStubEngine();
    const session = await engine.createSession({
      cwd: "/repo",
      policyContext,
      gate: (call) => evaluate(defaultPolicy, policyContext, call.action),
    });
    const events: EngineEvent[] = [];
    session.subscribe((e) => events.push(e));
    await session.prompt("hello");
    expect(events).toEqual([{ type: "message_delta", text: "stub: hello" }, { type: "turn_end" }]);
    await session.dispose();
    await expect(session.prompt("again")).rejects.toThrow("disposed");
  });

  it("sends every tool call through the gate", async () => {
    const engine = createStubEngine({
      toolCalls: [
        { id: "1", tool: "edit", action: { capability: "edit_workspace", paths: ["src/a.ts"] } },
        { id: "2", tool: "edit", action: { capability: "edit_workspace", paths: ["auth/a.ts"] } },
      ],
    });
    const session = await engine.createSession({
      cwd: "/repo",
      policyContext,
      gate: (call) => evaluate(defaultPolicy, policyContext, call.action),
    });
    const decisions: string[] = [];
    session.subscribe((e) => {
      if (e.type === "tool_decision") decisions.push(e.result.decision);
    });
    await session.prompt("fix it");
    expect(decisions).toEqual(["allow", "ask"]);
  });

  it("records the Pi packages to pin, all at one exact version", () => {
    const versions = new Set(Object.values(PI_PACKAGES));
    expect(versions.size).toBe(1);
    for (const v of versions) expect(v).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  type AutonomyPreset,
  createAutonomyGate,
  defaultPolicy,
  evaluate,
  type PolicyConfig,
  type PolicyContext,
} from "../src/index.js";

// A hypothetical preset that turns alwaysAskRisky off at the top level. secret_access must still
// ask: it is a floor that no preset or level can lift.
const trusted: AutonomyPreset = {
  id: "trusted",
  label: "Trusted",
  ceiling: "L4",
  autoAllow: "granted",
  alwaysAskRisky: false,
  requiresOptIn: false,
  requiresSandbox: false,
};
const policy: PolicyConfig = { ...defaultPolicy, presets: [...defaultPolicy.presets, trusted] };
const context: PolicyContext = {
  presetId: "trusted",
  earnedLevelId: "L4",
  optedIn: true,
  sandboxAvailable: true,
};

describe("secret_access always asks", () => {
  it("the hypothetical preset really does allow other risky classes at L4", () => {
    expect(
      evaluate(policy, context, { capability: "read", riskyClass: "migration" }),
    ).toMatchObject({ decision: "allow" });
  });

  it("asks for secret_access even with alwaysAskRisky off at L3 and L4", () => {
    for (const earnedLevelId of ["L3", "L4"]) {
      const result = evaluate(
        policy,
        { ...context, earnedLevelId },
        { capability: "read", paths: [".env"], riskyClass: "secret_access" },
      );
      expect(result.decision).toBe("ask");
      expect(result.reason).toContain("secret_access");
    }
  });

  it("asks for secret_access edits too", () => {
    expect(
      evaluate(policy, context, {
        capability: "edit_workspace",
        paths: [".env"],
        riskyClass: "secret_access",
      }).decision,
    ).toBe("ask");
  });

  it("never turns a block into an ask", () => {
    expect(
      evaluate(policy, context, { capability: "tool:mystery", riskyClass: "secret_access" })
        .decision,
    ).toBe("block");
  });

  it("the gate sends a secret read to the approver under the hypothetical preset", async () => {
    const approve = vi.fn(async () => false);
    const gate = createAutonomyGate({
      policy,
      cwd: process.platform === "win32" ? "C:\\work\\repo" : "/work/repo",
      policyContext: context,
      approve,
    });
    expect(
      (await gate({ toolName: "read", toolCallId: "1", input: { path: ".env" } }))?.block,
    ).toBe(true);
    expect(approve).toHaveBeenCalledOnce();
    // A plain read under the same preset is still allowed without asking.
    expect(
      await gate({ toolName: "read", toolCallId: "2", input: { path: "src/a.ts" } }),
    ).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import * as engineClient from "../src/engine-client.js";
import {
  ALWAYS_ASK_RISKY_CLASSES,
  classifyToolCall,
  RISK_LABELS,
  riskLabel,
} from "../src/index.js";

describe("plain-word risk labels (shared by the CLI box and the VS Code modal)", () => {
  it("names every risky class the classifier and policy can produce", () => {
    const ids = [
      "secret_access",
      "path_outside_workspace",
      "ci_change",
      "unclassified_command",
      "safe_zone",
    ];
    for (const id of [...ids, ...ALWAYS_ASK_RISKY_CLASSES]) {
      const label = riskLabel(id);
      expect(label).toBe(RISK_LABELS[id]);
      expect(label).not.toMatch(/_/);
    }
  });

  it("covers what the classifier emits for real tool calls", () => {
    const cwd = "/repo";
    const calls: Array<[string, Record<string, unknown>]> = [
      ["bash", { command: "ls" }],
      ["write", { path: ".github/workflows/ci.yml", content: "" }],
      ["read", { path: ".env" }],
      ["read", { path: "/etc/hosts" }],
    ];
    for (const [tool, input] of calls) {
      const risky = classifyToolCall(tool, input, cwd).riskyClass;
      expect(risky).toBeDefined();
      expect(Object.hasOwn(RISK_LABELS, risky as string)).toBe(true);
    }
  });

  it("never shows a raw id: unknown ids get a generic label, none gives undefined", () => {
    expect(riskLabel("brand_new_class")).toBe("needs your approval");
    expect(riskLabel("toString")).toBe("needs your approval");
    expect(riskLabel(undefined)).toBeUndefined();
  });

  it("is exported from the Pi-free engine-client entry", () => {
    expect(engineClient.riskLabel).toBe(riskLabel);
    expect(engineClient.RISK_LABELS).toBe(RISK_LABELS);
  });
});

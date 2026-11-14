import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxProvider } from "@earendil-works/pi-ai";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as publicApi from "../src/index.js";
import { createBlameModelRuntime, createBlameSession, type PolicyContext } from "../src/index.js";
// Test-only hook: not exported from the package index (checked below).
import { TEST_ONLY_EXTRA_EXTENSION_FACTORIES } from "../src/session/test-hooks.js";

const guidedL2: PolicyContext = {
  presetId: "guided",
  earnedLevelId: "L2",
  optedIn: false,
  sandboxAvailable: false,
};

let workDir: string;
let configDir: string;
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "blame-exterr-work-"));
  configDir = mkdtempSync(join(tmpdir(), "blame-exterr-config-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(workDir, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
});

async function options() {
  const faux = fauxProvider();
  const modelRuntime = await createBlameModelRuntime();
  modelRuntime.registerNativeProvider(faux.provider);
  return {
    cwd: workDir,
    configDir,
    model: { providerId: "faux", modelId: "faux-1" },
    policyContext: guidedL2,
    modelRuntime,
  };
}

describe("T-19 createBlameSession refuses to start on an extension load error (#40)", () => {
  it("rejects and disposes the Pi session when an extension factory throws", async () => {
    const dispose = vi.spyOn(AgentSession.prototype, "dispose");
    const throwing = () => {
      throw new Error("planted extension failure");
    };
    await expect(
      createBlameSession({
        ...(await options()),
        [TEST_ONLY_EXTRA_EXTENSION_FACTORIES]: [throwing],
      } as Parameters<typeof createBlameSession>[0]),
    ).rejects.toThrow(/Blame extensions failed to load: .*planted extension failure/);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("starts normally with a factory that loads, so the hook itself is not what fails", async () => {
    const loaded = vi.fn();
    const session = await createBlameSession({
      ...(await options()),
      [TEST_ONLY_EXTRA_EXTENSION_FACTORIES]: [loaded],
    } as Parameters<typeof createBlameSession>[0]);
    try {
      expect(loaded).toHaveBeenCalled();
      expect(session.extensionErrors).toEqual([]);
    } finally {
      session.dispose();
    }
  });

  it("ignores a string key with the same name, so plain config cannot reach the hook", async () => {
    const throwing = vi.fn(() => {
      throw new Error("must not load");
    });
    const session = await createBlameSession({
      ...(await options()),
      ["blame.testOnlyExtraExtensionFactories"]: [throwing],
    } as Parameters<typeof createBlameSession>[0]);
    session.dispose();
    expect(throwing).not.toHaveBeenCalled();
  });

  it("keeps the hook out of the package's public exports", () => {
    expect(Object.keys(publicApi)).not.toContain("TEST_ONLY_EXTRA_EXTENSION_FACTORIES");
    const indexes = ["src/index.ts", "src/session/index.ts"].map((f) =>
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", f), "utf8"),
    );
    for (const text of indexes) expect(text).not.toContain("test-hooks");
  });
});

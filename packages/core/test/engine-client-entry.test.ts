import { describe, expect, it } from "vitest";
import * as entry from "../src/engine-client.js";
import { APPROVAL_TIMEOUT_MS } from "../src/index.js";
import { APPROVAL_TIMEOUT_MS as constantsTimeout } from "../src/session/constants.js";

// The VS Code extension host imports this subpath. It must carry the client and its helpers only,
// so the extension bundle stays free of Pi (apps/vscode/test/bundle.test.ts checks the bundle).
describe("@blame-ai/core/engine-client", () => {
  it("exports the client, runtime, framing and redaction helpers", () => {
    expect(entry.BlameEngineClient).toBeTypeOf("function");
    expect(entry.EngineExitedError).toBeTypeOf("function");
    expect(entry.resolveEngineRuntime).toBeTypeOf("function");
    expect(entry.buildEngineEnv).toBeTypeOf("function");
    expect(entry.redactDeep).toBeTypeOf("function");
    expect(entry.BLAME_PROTOCOL_VERSION).toBe(1);
  });

  it("does not export the engine server or session factories", () => {
    expect(Object.keys(entry)).not.toContain("runEngineServer");
    expect(Object.keys(entry)).not.toContain("createBlameSession");
    expect(Object.keys(entry)).not.toContain("createBlameModelRuntime");
  });

  it("keeps one approval timeout constant shared by the session and the client", () => {
    expect(constantsTimeout).toBe(APPROVAL_TIMEOUT_MS);
    expect(entry.APPROVAL_TIMEOUT_MS).toBe(APPROVAL_TIMEOUT_MS);
  });

  it("is published as a package subpath", async () => {
    const pkg = (await import("../package.json", { with: { type: "json" } })).default as {
      exports: Record<string, Record<string, string>>;
    };
    expect(pkg.exports["./engine-client"]).toEqual({
      "@blame-ai/source": "./src/engine-client.ts",
      types: "./dist/engine-client.d.ts",
      default: "./dist/engine-client.js",
    });
  });
});

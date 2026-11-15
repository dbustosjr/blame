import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function inputs(name: string): string[] {
  const meta = JSON.parse(readFileSync(join(appDir, "dist", `${name}.meta.json`), "utf8")) as {
    inputs: Record<string, unknown>;
  };
  return Object.keys(meta.inputs);
}

describe("extension bundles", () => {
  it("keeps Pi out of the extension host bundle so activation stays light", () => {
    const files = inputs("extension");
    expect(files.some((f) => f.includes("engine-client"))).toBe(true);
    expect(files.filter((f) => f.includes("@earendil-works"))).toEqual([]);
    expect(files.filter((f) => f.includes("packages/core/src/session/session"))).toEqual([]);
  });

  it("bundles the engine entry with Pi into dist/engine.mjs", () => {
    expect(existsSync(join(appDir, "dist", "engine.mjs"))).toBe(true);
    expect(inputs("engine").some((f) => f.includes("packages/core/src/rpc/main.ts"))).toBe(true);
  });

  it("ships the engine bundle in the .vsix", () => {
    const ignore = readFileSync(join(appDir, ".vscodeignore"), "utf8").split(/\r?\n/);
    expect(ignore).toContain("!dist/engine.mjs");
    expect(ignore).toContain("!dist/extension.js");
  });
});

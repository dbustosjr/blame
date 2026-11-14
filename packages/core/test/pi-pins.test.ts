import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PI_PACKAGES } from "../src/index.js";

describe("Pi pins", () => {
  it("packages/core depends on every pinned Pi package at exactly the PI_PACKAGES version", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const piDeps = Object.entries(pkg.dependencies ?? {}).filter(([name]) =>
      name.startsWith("@earendil-works/"),
    );
    expect(piDeps.length).toBeGreaterThan(0);
    for (const [name, version] of piDeps) {
      expect(PI_PACKAGES[name as keyof typeof PI_PACKAGES]).toBe(version);
    }
  });
});

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { findDashes } from "./check-dashes.mjs";
import { findViolations } from "./check-import-boundary.mjs";

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "blame-boundary-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

// Built from parts so this test file does not trip the boundary check itself.
const PI = "@earendil-works/";

describe("import boundary", () => {
  it("allows Pi in packages/core", () => {
    const root = repo({
      "packages/core/src/session.ts": `import { createAgentSession } from "${PI}pi-coding-agent";`,
      "packages/core/package.json": '{"dependencies":{"@earendil-works/pi-coding-agent":"1.5.2"}}',
    });
    expect(findViolations(root)).toEqual([]);
  });

  it("fails when apps/cli imports Pi in any form", () => {
    const root = repo({
      "apps/cli/src/a.ts": `import { x } from "${PI}pi-tui";`,
      "apps/cli/src/b.ts": `const m = await import("${PI}pi-ai");`,
      "apps/cli/src/c.cjs": `const m = require("${PI}pi-agent-core");`,
      "apps/cli/package.json": '{"dependencies":{"@earendil-works/pi-tui":"1.5.2"}}',
    });
    expect(findViolations(root)).toHaveLength(4);
  });
});

describe("dash check", () => {
  it("flags em and en dashes", () => {
    const files: Record<string, string> = {
      "a.md": "fine - hyphen",
      "b.md": "bad \u2014 em",
      "c.md": "bad \u2013 en",
    };
    const hits = findDashes(Object.keys(files), (f: string) => files[f] ?? "");
    expect(hits.map((h: string) => h.split(":")[0])).toEqual(["b.md", "c.md"]);
  });
});

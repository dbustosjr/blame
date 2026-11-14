import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type BlameSession, createBlameModelRuntime, createBlameSession } from "../src/index.js";

// Repo files are untrusted (TRD C-6, THREAT_MODEL T-01): a repo must never load code into Blame's
// agent, and Blame must never write Pi's auth.json (TRD FR-KEY-2).

let workDir: string;
let configDir: string;
let session: BlameSession | undefined;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "blame-untrusted-"));
  configDir = mkdtempSync(join(tmpdir(), "blame-config-"));
});

afterEach(() => {
  session?.dispose();
  session = undefined;
  rmSync(workDir, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
});

describe("session isolation", () => {
  it("does not load a Pi extension planted in the repo's .pi/extensions", async () => {
    const marker = join(workDir, "evil-ran.txt");
    mkdirSync(join(workDir, ".pi", "extensions"), { recursive: true });
    writeFileSync(
      join(workDir, ".pi", "extensions", "evil.ts"),
      [
        'import { writeFileSync } from "node:fs";',
        "export default function (pi) {",
        `  writeFileSync(${JSON.stringify(marker)}, "loaded");`,
        '  pi.registerTool({ name: "evil", label: "evil", description: "x", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [], details: {} }) });',
        "}",
        "",
      ].join("\n"),
    );
    const faux = fauxProvider();
    faux.setResponses([fauxAssistantMessage("ok")]);
    const modelRuntime = await createBlameModelRuntime();
    modelRuntime.registerNativeProvider(faux.provider);
    session = await createBlameSession({
      cwd: workDir,
      configDir,
      model: { providerId: "faux", modelId: "faux-1" },
      policyContext: {
        presetId: "guided",
        earnedLevelId: "L2",
        optedIn: false,
        sandboxAvailable: false,
      },
      modelRuntime,
    });
    await session.prompt("hi");
    expect(existsSync(marker)).toBe(false);
    expect(session.pi.getActiveToolNames()).not.toContain("evil");
  });

  it("does not create auth.json in the user's ~/.pi/agent", async () => {
    const piAuth = join(homedir(), ".pi", "agent", "auth.json");
    const before = existsSync(piAuth);
    const faux = fauxProvider();
    faux.setResponses([fauxAssistantMessage("ok")]);
    const modelRuntime = await createBlameModelRuntime();
    modelRuntime.registerNativeProvider(faux.provider);
    session = await createBlameSession({
      cwd: workDir,
      configDir,
      model: { providerId: "faux", modelId: "faux-1" },
      apiKey: "sk-blame-test-not-a-real-key",
      policyContext: {
        presetId: "guided",
        earnedLevelId: "L2",
        optedIn: false,
        sandboxAvailable: false,
      },
      modelRuntime,
    });
    await session.prompt("hi");
    expect(existsSync(piAuth)).toBe(before);
    expect(existsSync(join(configDir, "agent", "auth.json"))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { modes, parseCliArgs } from "../src/args.js";
import { resolveEngineEntry } from "../src/engine/entry.js";
import type { RunTaskOptions } from "../src/engine/run.js";
import { main } from "../src/main.js";

async function run(argv: string[], env: Record<string, string> = {}) {
  let out = "";
  let err = "";
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const code = await main(argv, {
      stdout: { write: (s: string) => (out += s), isTTY: true, columns: 80 },
      stderr: { write: (s: string) => (err += s) },
      cwd: "/repo",
    });
    return { code, out, err };
  } finally {
    process.env = saved;
  }
}

describe("argument parsing", () => {
  it("accepts manual, guided and autonomous for --mode", () => {
    expect(modes).toEqual(["manual", "guided", "autonomous"]);
    for (const mode of modes)
      expect(parseCliArgs(["--mode", mode])).toMatchObject({ kind: "run", mode });
    expect(parseCliArgs(["--mode=Guided"])).toMatchObject({ kind: "run", mode: "guided" });
  });

  it("defaults to guided", () => {
    expect(parseCliArgs([])).toEqual({
      kind: "run",
      mode: "guided",
      provider: "anthropic",
      verbose: false,
    });
  });

  it("rejects unknown modes and flags", () => {
    expect(parseCliArgs(["--mode", "auto"]).kind).toBe("error");
    expect(parseCliArgs(["--yolo"]).kind).toBe("error");
  });
});

describe("task arguments", () => {
  it("takes the task as positional words, plus --provider, --model and --verbose", () => {
    expect(
      parseCliArgs(["--provider", "openai", "--model", "gpt-5", "--verbose", "fix", "the", "bug"]),
    ).toEqual({
      kind: "run",
      mode: "guided",
      provider: "openai",
      model: "gpt-5",
      verbose: true,
      task: "fix the bug",
    });
  });

  it("documents the task, the key sources and --verbose in help", async () => {
    const { out } = await run(["--help"]);
    expect(out).toContain("blame [options] [task...]");
    expect(out).toContain("BLAME_API_KEY");
    expect(out).toContain("--verbose");
    expect(out).toContain("--model <id>");
    expect(out).toContain("Autonomous does not run tools until");
    expect(out).not.toMatch(/Autonomous[^.]*\bask/);
  });

  it("asks for --model before running a task", async () => {
    const { code, err } = await run(["fix", "it"]);
    expect(code).toBe(2);
    expect(err).toContain("--model");
  });
});

describe("main", () => {
  it("prints the version", async () => {
    expect(await run(["--version"])).toEqual({ code: 0, out: "0.0.0\n", err: "" });
  });

  it("prints help that lists the modes", async () => {
    const { code, out } = await run(["--help"]);
    expect(code).toBe(0);
    expect(out).toContain("--mode <mode>");
    expect(out).toContain("manual, guided, autonomous");
  });

  it("exits 2 with a message on a bad mode", async () => {
    const { code, err } = await run(["--mode", "auto"]);
    expect(code).toBe(2);
    expect(err).toContain('Unknown mode "auto"');
  });

  it("prints no escape codes with NO_COLOR", async () => {
    const { code, out } = await run(["--mode", "manual"], {
      NO_COLOR: "1",
      COLORTERM: "truecolor",
    });
    expect(code).toBe(0);
    expect(out).not.toContain("\u001b[");
    expect(out).toContain("Manual (L1)");
  });
});

describe("main runs a task through the engine", () => {
  it("passes the explicit engine entry, the preset, the model and a key source", async () => {
    const calls: RunTaskOptions[] = [];
    const code = await main(["--mode", "autonomous", "--model", "m1", "--verbose", "fix", "it"], {
      stdout: { write: () => true },
      stderr: { write: () => true },
      cwd: "/repo",
      envKey: { name: "test", get: async () => "k" },
      runTask: async (o) => {
        calls.push(o);
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(calls[0]).toMatchObject({
      task: "fix it",
      cwd: "/repo",
      presetId: "autonomous",
      providerId: "anthropic",
      modelId: "m1",
      verbose: true,
      entry: resolveEngineEntry(),
    });
    expect(await calls[0]?.keySource.get("anthropic")).toBe("k");
    expect(calls[0]?.logFile).toMatch(/logs[\\/]engine\.log$/);
  });
});

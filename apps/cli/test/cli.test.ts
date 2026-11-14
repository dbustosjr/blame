import { describe, expect, it } from "vitest";
import { modes, parseCliArgs } from "../src/args.js";
import { main } from "../src/main.js";

function run(argv: string[], env: Record<string, string> = {}) {
  let out = "";
  let err = "";
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const code = main(argv, {
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
    for (const mode of modes) expect(parseCliArgs(["--mode", mode])).toEqual({ kind: "run", mode });
    expect(parseCliArgs(["--mode=Guided"])).toEqual({ kind: "run", mode: "guided" });
  });

  it("defaults to guided", () => {
    expect(parseCliArgs([])).toEqual({ kind: "run", mode: "guided" });
  });

  it("rejects unknown modes and flags", () => {
    expect(parseCliArgs(["--mode", "auto"]).kind).toBe("error");
    expect(parseCliArgs(["--yolo"]).kind).toBe("error");
  });
});

describe("main", () => {
  it("prints the version", () => {
    expect(run(["--version"])).toEqual({ code: 0, out: "0.0.0\n", err: "" });
  });

  it("prints help that lists the modes", () => {
    const { code, out } = run(["--help"]);
    expect(code).toBe(0);
    expect(out).toContain("--mode <mode>");
    expect(out).toContain("manual, guided, autonomous");
  });

  it("exits 2 with a message on a bad mode", () => {
    const { code, err } = run(["--mode", "auto"]);
    expect(code).toBe(2);
    expect(err).toContain('Unknown mode "auto"');
  });

  it("prints no escape codes with NO_COLOR", () => {
    const { code, out } = run(["--mode", "manual"], { NO_COLOR: "1", COLORTERM: "truecolor" });
    expect(code).toBe(0);
    expect(out).not.toContain("\u001b[");
    expect(out).toContain("Manual (L1)");
  });
});

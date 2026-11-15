import { PassThrough } from "node:stream";
import type { ApprovalPrompt } from "@blame-ai/core/engine-client";
import { describe, expect, it } from "vitest";
import { askHidden, createTerminalApprover, renderApprovalBox } from "../src/engine/approval.js";
import { createTheme, stripAnsi } from "../src/theme.js";

const write: ApprovalPrompt = {
  id: "a1",
  toolName: "write",
  toolCallId: "t1",
  capability: "edit_workspace",
  paths: ["auth/login.ts"],
  riskyClass: "safe_zone",
  reason: "auth/ is a safe zone",
  timeoutMs: 300_000,
};

function tty() {
  const input = new PassThrough() as PassThrough & { isTTY?: boolean; setRawMode?: unknown };
  input.isTTY = true;
  const output = new PassThrough();
  let shown = "";
  output.on("data", (c: Buffer) => {
    shown += c.toString("utf8");
  });
  return { input, output, shown: () => stripAnsi(shown) };
}

const theme = createTheme("none");

describe("terminal approval box (DESIGN.md permission prompt)", () => {
  it("is a bordered box naming the tool, the exact file and the reason, with numbered choices", () => {
    const box = stripAnsi(renderApprovalBox(write, theme));
    expect(box).toContain("write");
    expect(box).toContain("auth/login.ts");
    expect(box).toContain("auth/ is a safe zone");
    expect(box).toContain("1. Allow once");
    expect(box).toContain("2. Deny");
    expect(box.split("\n")[0]).toMatch(/^\u256D\u2500+\u256E$/);
  });

  it("colors the border with status.warning (approval pending)", () => {
    const box = renderApprovalBox(write, createTheme("truecolor"));
    expect(box).toContain("\u001b[38;2;245;181;68m");
  });

  it("wraps a long path onto more lines instead of clipping it", () => {
    const long =
      "packages/very/deeply/nested/directory/structure/that/goes/on/and/on/login-handler.ts";
    const box = stripAnsi(renderApprovalBox({ ...write, paths: [long] }, theme, 60));
    expect(box).not.toContain("...");
    expect(box).toContain("login-handler.ts");
    const lines = box.trimEnd().split("\n");
    expect(lines.every((l) => l.length === 60)).toBe(true);
    const joined = lines.map((l) => l.slice(2, -2).trim()).join("");
    expect(joined).toContain(long);
  });

  it("wraps a long reason too", () => {
    const reason = "This is a long reason that will not fit on one line of the box at all, really";
    const box = stripAnsi(renderApprovalBox({ ...write, reason }, theme, 40));
    expect(box).not.toContain("...");
    expect(box.replace(/[\u2502|\s]+/g, " ")).toContain(reason);
  });

  it("shows a plain-word risk label from core, never the raw id", () => {
    const box = stripAnsi(renderApprovalBox(write, theme));
    expect(box).toContain("risk: protected area (safe zone)");
    expect(box).not.toContain("safe_zone");
    const secret = stripAnsi(renderApprovalBox({ ...write, riskyClass: "secret_access" }, theme));
    expect(secret).toContain("risk: file that may hold secrets");
    const unknown = stripAnsi(renderApprovalBox({ ...write, riskyClass: "new_thing" }, theme));
    expect(unknown).toContain("risk: needs your approval");
    expect(unknown).not.toContain("new_thing");
  });

  it("drops the border below 40 columns and still wraps to the width", () => {
    const box = stripAnsi(renderApprovalBox(write, theme, 30));
    expect(box).not.toMatch(/[\u256D\u256E\u2570\u256F\u2502]/);
    const lines = box.trimEnd().split("\n");
    expect(lines.every((l) => l.length <= 30)).toBe(true);
    expect(box).toContain("auth/login.ts");
    expect(box).toContain("1. Allow once");
  });

  it("falls back to ASCII borders", () => {
    const box = renderApprovalBox(write, createTheme("none", false));
    expect(box.split("\n")[0]).toMatch(/^\+-+\+$/);
  });
});

describe("terminal approver fails closed", () => {
  for (const [answer, expected] of [
    ["1", true],
    ["y", true],
    ["YES", true],
    ["2", false],
    ["n", false],
    ["", false],
    ["sure", false],
  ] as const) {
    it(`answer ${JSON.stringify(answer)} gives ${expected}`, async () => {
      const t = tty();
      const ask = createTerminalApprover({ input: t.input, output: t.output, theme });
      const result = ask(write, new AbortController().signal);
      t.input.write(`${answer}\n`);
      expect(await result).toBe(expected);
      expect(t.shown()).toContain("auth/login.ts");
    });
  }

  it("denies without asking when stdin is not a terminal", async () => {
    const t = tty();
    t.input.isTTY = false;
    const ask = createTerminalApprover({ input: t.input, output: t.output, theme });
    expect(await ask(write, new AbortController().signal)).toBe(false);
    expect(t.shown()).toMatch(/denied: no terminal/i);
  });

  it("shows the user's own deny in secondary text, not error red", async () => {
    const t = tty();
    const ask = createTerminalApprover({
      input: t.input,
      output: t.output,
      theme: createTheme("truecolor"),
    });
    let raw = "";
    t.output.on("data", (c: Buffer) => {
      raw += c.toString("utf8");
    });
    const result = ask(write, new AbortController().signal);
    t.input.write("2\n");
    expect(await result).toBe(false);
    const deniedAt = raw.lastIndexOf("Denied:");
    const before = raw.slice(Math.max(0, deniedAt - 30), deniedAt);
    expect(before).not.toContain("\u001b[38;2;255;107;107m");
    expect(before).toContain("\u001b[38;2;169;167;204m");
  });

  it("denies on Ctrl-C", async () => {
    const t = tty();
    const ask = createTerminalApprover({ input: t.input, output: t.output, theme });
    const result = ask(write, new AbortController().signal);
    t.input.write("\u0003");
    expect(await result).toBe(false);
  });

  it("denies on EOF", async () => {
    const t = tty();
    const ask = createTerminalApprover({ input: t.input, output: t.output, theme });
    const result = ask(write, new AbortController().signal);
    t.input.end();
    expect(await result).toBe(false);
  });

  it("denies when the request times out or is cancelled, and ignores a late answer", async () => {
    const t = tty();
    const ask = createTerminalApprover({ input: t.input, output: t.output, theme });
    const ctrl = new AbortController();
    const result = ask(write, ctrl.signal);
    ctrl.abort();
    expect(await result).toBe(false);
    expect(t.shown()).toMatch(/timed out|cancelled/i);
  });

  it("denies a request that is already cancelled without drawing the box", async () => {
    const t = tty();
    const ask = createTerminalApprover({ input: t.input, output: t.output, theme });
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await ask(write, ctrl.signal)).toBe(false);
    expect(t.shown()).not.toContain("auth/login.ts");
  });
});

describe("masked key prompt", () => {
  it("reads one line without echoing it", async () => {
    const t = tty();
    const result = askHidden(t.input, t.output, "Model key: ");
    t.input.write("typed-secret-value\n");
    expect(await result).toBe("typed-secret-value");
    expect(t.shown()).toContain("Model key:");
    expect(t.shown()).not.toContain("typed-secret-value");
  });

  it("gives nothing with no TTY, on Ctrl-C, or on EOF", async () => {
    const noTty = tty();
    noTty.input.isTTY = false;
    expect(await askHidden(noTty.input, noTty.output, "k: ")).toBeUndefined();
    const ctrlC = tty();
    const a = askHidden(ctrlC.input, ctrlC.output, "k: ");
    ctrlC.input.write("\u0003");
    expect(await a).toBeUndefined();
    const eof = tty();
    const b = askHidden(eof.input, eof.output, "k: ");
    eof.input.end();
    expect(await b).toBeUndefined();
  });
});

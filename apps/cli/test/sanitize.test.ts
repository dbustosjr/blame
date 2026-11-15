import { describe, expect, it } from "vitest";
import { createTerminalSanitizer, sanitizeForTerminal } from "../src/sanitize.js";

describe("terminal sanitizer for model text, errors and block reasons", () => {
  it("keeps plain text, \\n and \\t", () => {
    expect(sanitizeForTerminal("line one\n\tindented\n")).toBe("line one\n\tindented\n");
  });

  it("strips CSI sequences such as cursor moves and colors", () => {
    expect(sanitizeForTerminal("a\u001b[1A\u001b[2Kb\u001b[31mred\u001b[0m")).toBe("abred");
  });

  it("strips C1 CSI (\\x9b) sequences", () => {
    expect(sanitizeForTerminal("x\u009b2Jy")).toBe("xy");
  });

  it("strips OSC with BEL or ST terminators, and DCS strings", () => {
    expect(sanitizeForTerminal("a\u001b]0;title\u0007b")).toBe("ab");
    expect(sanitizeForTerminal("a\u001b]8;;http://x\u001b\\link\u001b]8;;\u001b\\b")).toBe(
      "alinkb",
    );
    expect(sanitizeForTerminal("a\u009d0;t\u009cb")).toBe("ab");
    expect(sanitizeForTerminal("a\u001bPq#0;data\u001b\\b")).toBe("ab");
  });

  it("strips lone ESC, two-byte escapes and other control characters", () => {
    expect(sanitizeForTerminal("a\u001bcb\u001b7c\u001b(Bd")).toBe("abcd");
    expect(sanitizeForTerminal("a\rb\u0007c\u0000d\u007fe\u0085f")).toBe("abcdef");
    expect(sanitizeForTerminal("end\u001b")).toBe("end");
  });

  it("strips a sequence split across chunks", () => {
    const s = createTerminalSanitizer();
    const out = [
      s.push("hello \u001b"),
      s.push("[1"),
      s.push("A\u001b[2"),
      s.push("Kworld\u001b]0;t"),
      s.push("itle\u0007!"),
    ];
    expect(out.join("") + s.flush()).toBe("hello world!");
  });
});

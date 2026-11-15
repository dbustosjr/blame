import { describe, expect, it } from "vitest";
import { wrapField, wrapText } from "../src/wrap.js";

describe("wrapText (approval box paths, reasons and the coming command field)", () => {
  it("wraps on spaces and keeps every character", () => {
    const lines = wrapText("the quick brown fox jumps over the lazy dog", 10);
    expect(lines.every((l) => l.length <= 10)).toBe(true);
    expect(lines.join(" ")).toBe("the quick brown fox jumps over the lazy dog");
  });

  it("breaks a long path after slashes, never dropping the file name", () => {
    const path = "packages/very/deeply/nested/directory/structure/for/tests/login-handler.ts";
    const lines = wrapText(path, 20);
    expect(lines.every((l) => l.length <= 20)).toBe(true);
    expect(lines.join("")).toBe(path);
    expect(lines.at(-1)).toContain("login-handler.ts");
    expect(lines.slice(0, -1).every((l) => l.endsWith("/"))).toBe(true);
  });

  it("hard-breaks a word with no break points", () => {
    const word = "x".repeat(25);
    expect(wrapText(word, 10)).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
  });

  it("keeps an empty value as one empty line", () => {
    expect(wrapText("", 10)).toEqual([""]);
  });

  it("wrapField indents continuation lines under the value", () => {
    const lines = wrapField("file:", "src/a/b/c/d/e/f/name.ts", 16);
    expect(lines[0]?.startsWith("file: ")).toBe(true);
    for (const line of lines.slice(1)) expect(line.startsWith("      ")).toBe(true);
    expect(lines.every((l) => l.length <= 16)).toBe(true);
    expect(lines.map((l, i) => (i === 0 ? l.slice(6) : l.trimStart())).join("")).toBe(
      "src/a/b/c/d/e/f/name.ts",
    );
  });
});

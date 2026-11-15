import { describe, expect, it } from "vitest";
import { escapeControl, wrapField, wrapText } from "../src/wrap.js";
import { controlChars } from "./control.js";

describe("wrapText (approval box paths, reasons and the coming command field)", () => {
  it("joining the lines reproduces the text exactly: double, leading and trailing spaces kept", () => {
    const samples = [
      "a  b.txt",
      "  leading and trailing  ",
      "the quick  brown   fox jumps over the lazy dog",
      "rm -rf  ./build   &&  echo   done",
      " ",
      "",
    ];
    for (const text of samples) {
      for (const width of [1, 3, 7, 10, 40]) {
        const lines = wrapText(text, width);
        expect(lines.join("")).toBe(text);
        expect(lines.every((l) => l.length <= width)).toBe(true);
      }
    }
  });

  it("prefers to break at existing spaces, keeping each space at the end of its line", () => {
    expect(wrapText("aaa bbb ccc", 8)).toEqual(["aaa bbb ", "ccc"]);
    expect(wrapText("a  b.txt", 4)).toEqual(["a  ", "b.tx", "t"]);
  });

  it("breaks a long path after slashes, never dropping the file name", () => {
    const path = "packages/very/deeply/nested/directory/structure/for/tests/login-handler.ts";
    const lines = wrapText(path, 20);
    expect(lines.every((l) => l.length <= 20)).toBe(true);
    expect(lines.join("")).toBe(path);
    expect(lines.at(-1)).toContain("login-handler.ts");
    expect(lines.slice(0, -1).every((l) => l.endsWith("/"))).toBe(true);
  });

  it("hard-breaks a token with no break points", () => {
    const word = "x".repeat(25);
    expect(wrapText(word, 10)).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
  });

  it("keeps an empty value as one empty line", () => {
    expect(wrapText("", 10)).toEqual([""]);
  });

  it("shows tabs, newlines, escapes and other control characters visibly instead of running them", () => {
    const text = "a\tb\nc\rd\u001b[31mred\u0007\u0000\u007f\u009b";
    const lines = wrapText(text, 80);
    const shown = lines.join("");
    expect(shown).toBe("a\\tb\\nc\\rd\\x1b[31mred\\x07\\x00\\x7f\\x9b");
    expect(controlChars(shown)).toEqual([]);
    expect(lines.join("")).toBe(escapeControl(text));
  });

  it("escapes characters that can hide or reorder text (bidi overrides, zero-width)", () => {
    const sneaky = "safe\u202Etxt.exe\u200B\u2066x\uFEFF";
    expect(escapeControl(sneaky)).toBe("safe\\u{202e}txt.exe\\u{200b}\\u{2066}x\\u{feff}");
  });

  it("wraps escaped text without splitting it in a way that loses characters", () => {
    const text = "\t\t\u001b\u001b";
    const lines = wrapText(text, 3);
    expect(lines.join("")).toBe("\\t\\t\\x1b\\x1b");
    expect(lines.every((l) => l.length <= 3)).toBe(true);
  });

  it("wrapField indents continuation lines under the value and keeps the value exact", () => {
    const value = "src/a  b/c/d/e/f/name.ts ";
    const lines = wrapField("file:", value, 16);
    expect(lines[0]?.startsWith("file: ")).toBe(true);
    for (const line of lines.slice(1)) expect(line.startsWith("      ")).toBe(true);
    expect(lines.every((l) => l.length <= 16)).toBe(true);
    expect(lines.map((l) => l.slice(6)).join("")).toBe(value);
  });
});

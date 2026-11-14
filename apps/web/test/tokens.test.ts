import { readFileSync } from "node:fs";
import { color, trust } from "@blame-ai/design-tokens";
import { describe, expect, it } from "vitest";
import { tokenStyle } from "../lib/tokens";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("website tokens", () => {
  it("sets every DESIGN.md color as a CSS variable on <html>", () => {
    const style = tokenStyle as Record<string, string>;
    expect(style["--blame-bg-base"]).toBe(color["bg.base"]);
    expect(style["--blame-accent"]).toBe(color.accent);
    expect(style["--blame-trust-L3"]).toBe(trust.L3);
  });

  it("globals.css defines no color values of its own", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgb|hsl|oklch)a?\(/);
  });
});

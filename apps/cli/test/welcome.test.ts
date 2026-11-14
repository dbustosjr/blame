import { color, trust } from "@blame-ai/design-tokens";
import { Terminal } from "@xterm/headless";
import { describe, expect, it } from "vitest";
import { createTheme } from "../src/theme.js";
import { renderWelcome } from "../src/welcome.js";

async function renderToScreen(ansi: string, cols = 80, rows = 10): Promise<Terminal> {
  const term = new Terminal({ cols, rows, convertEol: true, allowProposedApi: true });
  await new Promise<void>((resolve) => term.write(ansi, resolve));
  return term;
}

function screenLines(term: Terminal): string[] {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let y = 0; y < term.rows; y++) {
    lines.push(buffer.getLine(y)?.translateToString(true) ?? "");
  }
  return lines;
}

const base = { cwd: "/home/dev/projects/blame", mode: "guided", version: "0.0.0" };

describe("welcome box (DESIGN.md terminal app)", () => {
  it("renders the screen grid at 80 columns", async () => {
    const term = await renderToScreen(renderWelcome({ ...base, theme: createTheme("truecolor") }));
    expect(screenLines(term).join("\n")).toMatchSnapshot();
  });

  it("uses border.strong for the border, accent for the wordmark and the trust color for the mode", async () => {
    const term = await renderToScreen(renderWelcome({ ...base, theme: createTheme("truecolor") }));
    const buffer = term.buffer.active;
    const rgb = (h: string) => Number.parseInt(h.slice(1), 16);

    const corner = buffer.getLine(0)?.getCell(0);
    expect(corner?.isFgRGB()).toBe(true);
    expect(corner?.getFgColor()).toBe(rgb(color["border.strong"]));

    const wordmarkLine = buffer.getLine(1)?.translateToString(true) ?? "";
    const wordmarkCell = buffer.getLine(1)?.getCell(wordmarkLine.indexOf("Blame"));
    expect(wordmarkCell?.getFgColor()).toBe(rgb(color.accent));
    expect(wordmarkCell?.isBold()).toBeTruthy();

    const modeLine = buffer.getLine(4)?.translateToString(true) ?? "";
    const modeCell = buffer.getLine(4)?.getCell(modeLine.indexOf("Guided"));
    expect(modeCell?.getFgColor()).toBe(rgb(trust.L2));
  });

  it("falls back to ASCII glyphs and plain text", async () => {
    const out = renderWelcome({ ...base, theme: createTheme("none", false) });
    expect(out).not.toContain("\u001b[");
    const term = await renderToScreen(out);
    expect(screenLines(term).join("\n")).toMatchSnapshot();
  });

  it("never exceeds 80 columns and keeps long paths inside the box", () => {
    const out = renderWelcome({
      ...base,
      cwd: `/very/${"long/".repeat(40)}path`,
      theme: createTheme("none"),
    });
    for (const line of out.trimEnd().split("\n")) expect(line.length).toBe(80);
  });
});

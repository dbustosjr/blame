import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type AnsiHueName,
  ansiHueNames,
  blameTerminalTheme,
  color,
  generateItermcolors,
  generateVSCodeSettings,
  generateWindowsTerminalScheme,
  hexToRgb,
  srgbComponentString,
  terminalColor,
  terminalThemeContents,
  themeFilenames,
  windowsTerminalScheme,
} from "../src/index.js";

const designMd = readFileSync(
  fileURLToPath(new URL("../../../docs/DESIGN.md", import.meta.url)),
  "utf8",
);

const themesDir = fileURLToPath(new URL("../themes", import.meta.url));

function optionalThemeSection(): string {
  const section = designMd.split("### Optional Blame terminal theme")[1] ?? "";
  const end = section.search(/\n## /);
  return end >= 0 ? section.slice(0, end) : section;
}

/** Rows from the Optional Blame terminal theme table in DESIGN.md. */
function parseOptionalThemeTable(): {
  meta: { background: string; foreground: string; cursor: string; selection: string };
  normal: Record<AnsiHueName, string>;
  bright: Record<AnsiHueName, string>;
} {
  const section = optionalThemeSection();
  const metaMatch = section.match(
    /Background\s+(#[0-9A-Fa-f]{6}),\s*foreground\s+(#[0-9A-Fa-f]{6}),\s*cursor\s+(#[0-9A-Fa-f]{6}),\s*selection\s+(#[0-9A-Fa-f]{6})/i,
  );
  if (!metaMatch?.[1] || !metaMatch[2] || !metaMatch[3] || !metaMatch[4]) {
    throw new Error("Could not parse background, foreground, cursor and selection from DESIGN.md");
  }

  const normal = {} as Record<AnsiHueName, string>;
  const bright = {} as Record<AnsiHueName, string>;
  for (const line of section.split("\n")) {
    const match =
      /^\|\s*(Black|Red|Green|Yellow|Blue|Magenta|Cyan|White)\s*\|\s*(#[0-9A-Fa-f]{6})\s*\|\s*(#[0-9A-Fa-f]{6})\s*\|/.exec(
        line,
      );
    if (!match?.[1] || !match[2] || !match[3]) continue;
    const hue = match[1].toLowerCase() as AnsiHueName;
    normal[hue] = match[2].toUpperCase();
    bright[hue] = match[3].toUpperCase();
  }
  if (ansiHueNames.some((name) => !normal[name] || !bright[name])) {
    throw new Error("Optional theme table in DESIGN.md is missing a color row");
  }

  return {
    meta: {
      background: metaMatch[1].toUpperCase(),
      foreground: metaMatch[2].toUpperCase(),
      cursor: metaMatch[3].toUpperCase(),
      selection: metaMatch[4].toUpperCase(),
    },
    normal,
    bright,
  };
}

// WCAG relative luminance, the same measure DESIGN.md uses for its contrast table.
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (channel: number) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function roundedRatio(hex: string, background: string): number {
  return Math.round(contrastRatio(hex, background) * 100) / 100;
}

describe("optional Blame terminal theme matches docs/DESIGN.md", () => {
  const fromDoc = parseOptionalThemeTable();

  it("uses the background, foreground, cursor and selection from the theme section", () => {
    expect(blameTerminalTheme.background).toBe(fromDoc.meta.background);
    expect(blameTerminalTheme.foreground).toBe(fromDoc.meta.foreground);
    expect(blameTerminalTheme.cursor).toBe(fromDoc.meta.cursor);
    expect(blameTerminalTheme.selection).toBe(fromDoc.meta.selection);
  });

  it("has every Normal and Bright table value", () => {
    expect(blameTerminalTheme.normal).toEqual(fromDoc.normal);
    expect(blameTerminalTheme.bright).toEqual(fromDoc.bright);
  });

  it("reuses tokens.ts values instead of duplicating them", () => {
    expect(blameTerminalTheme.background).toBe(color["bg.base"]);
    expect(blameTerminalTheme.cursor).toBe(color.accent);
    expect(blameTerminalTheme.selection).toBe(color["bg.raised"]);
    expect(blameTerminalTheme.normal.black).toBe(color["bg.base"]);
    expect(blameTerminalTheme.normal.red).toBe(color["status.error"]);
    expect(blameTerminalTheme.normal.green).toBe(color["status.success"]);
    expect(blameTerminalTheme.normal.yellow).toBe(color["status.warning"]);
    expect(blameTerminalTheme.normal.blue).toBe(color["status.info"]);
    expect(blameTerminalTheme.bright.black).toBe(terminalColor["ansi.brightBlackText"]);
    expect(blameTerminalTheme.bright.white).toBe(color["text.heading"]);
  });
});

describe("generated theme files stay in sync with the generators", () => {
  it("writes each file exactly as the generator returns it", () => {
    const expected = terminalThemeContents();
    for (const filename of Object.values(themeFilenames)) {
      const onDisk = readFileSync(join(themesDir, filename), "utf8");
      expect(onDisk, filename).toBe(expected[filename]);
    }
  });
});

describe("Windows Terminal scheme", () => {
  const scheme = windowsTerminalScheme();

  it("uses the documented color scheme keys, with magenta as purple", () => {
    expect(scheme).toEqual({
      name: "Blame",
      background: blameTerminalTheme.background,
      foreground: blameTerminalTheme.foreground,
      cursorColor: blameTerminalTheme.cursor,
      selectionBackground: blameTerminalTheme.selection,
      black: blameTerminalTheme.normal.black,
      red: blameTerminalTheme.normal.red,
      green: blameTerminalTheme.normal.green,
      yellow: blameTerminalTheme.normal.yellow,
      blue: blameTerminalTheme.normal.blue,
      purple: blameTerminalTheme.normal.magenta,
      cyan: blameTerminalTheme.normal.cyan,
      white: blameTerminalTheme.normal.white,
      brightBlack: blameTerminalTheme.bright.black,
      brightRed: blameTerminalTheme.bright.red,
      brightGreen: blameTerminalTheme.bright.green,
      brightYellow: blameTerminalTheme.bright.yellow,
      brightBlue: blameTerminalTheme.bright.blue,
      brightPurple: blameTerminalTheme.bright.magenta,
      brightCyan: blameTerminalTheme.bright.cyan,
      brightWhite: blameTerminalTheme.bright.white,
    });
    expect(generateWindowsTerminalScheme().endsWith("\n")).toBe(true);
  });
});

describe("iTerm2 itermcolors plist", () => {
  const plist = generateItermcolors();

  it("declares sRGB float components for Ansi 0 to 15 and the UI colors", () => {
    expect(plist.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(plist).toContain('<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"');
    const keys = [
      ...Array.from({ length: 16 }, (_, i) => `Ansi ${i} Color`),
      "Background Color",
      "Foreground Color",
      "Cursor Color",
      "Selection Color",
    ];
    for (const key of keys) {
      expect(plist).toContain(`<key>${key}</key>`);
    }
    const spaces = [...plist.matchAll(/<key>Color Space<\/key>\s*<string>([^<]+)<\/string>/g)];
    expect(spaces).toHaveLength(keys.length);
    for (const match of spaces) expect(match[1]).toBe("sRGB");
  });

  it("encodes each ANSI color as float sRGB of the theme hex", () => {
    const expected = [
      ...ansiHueNames.map((name) => blameTerminalTheme.normal[name]),
      ...ansiHueNames.map((name) => blameTerminalTheme.bright[name]),
    ];
    for (const [index, hex] of expected.entries()) {
      const { r, g, b } = hexToRgb(hex);
      const after = plist.split(`<key>Ansi ${index} Color</key>`)[1] ?? "";
      // Top-level keys are indented with one tab; component keys use two.
      const block = after.split("\n\t<key>")[0];
      expect(block).toContain(`<real>${srgbComponentString(r)}</real>`);
      expect(block).toContain(`<real>${srgbComponentString(g)}</real>`);
      expect(block).toContain(`<real>${srgbComponentString(b)}</real>`);
    }
  });
});

describe("VS Code settings snippet", () => {
  it("uses workbench.colorCustomizations and the documented terminal color keys", () => {
    const snippet = JSON.parse(generateVSCodeSettings()) as {
      "workbench.colorCustomizations": Record<string, string>;
    };
    const colors = snippet["workbench.colorCustomizations"];
    expect(colors["terminal.background"]).toBe(blameTerminalTheme.background);
    expect(colors["terminal.foreground"]).toBe(blameTerminalTheme.foreground);
    expect(colors["terminalCursor.foreground"]).toBe(blameTerminalTheme.cursor);
    expect(colors["terminal.selectionBackground"]).toBe(blameTerminalTheme.selection);
    expect(colors["terminal.ansiBlack"]).toBe(blameTerminalTheme.normal.black);
    expect(colors["terminal.ansiRed"]).toBe(blameTerminalTheme.normal.red);
    expect(colors["terminal.ansiGreen"]).toBe(blameTerminalTheme.normal.green);
    expect(colors["terminal.ansiYellow"]).toBe(blameTerminalTheme.normal.yellow);
    expect(colors["terminal.ansiBlue"]).toBe(blameTerminalTheme.normal.blue);
    expect(colors["terminal.ansiMagenta"]).toBe(blameTerminalTheme.normal.magenta);
    expect(colors["terminal.ansiCyan"]).toBe(blameTerminalTheme.normal.cyan);
    expect(colors["terminal.ansiWhite"]).toBe(blameTerminalTheme.normal.white);
    expect(colors["terminal.ansiBrightBlack"]).toBe(blameTerminalTheme.bright.black);
    expect(colors["terminal.ansiBrightRed"]).toBe(blameTerminalTheme.bright.red);
    expect(colors["terminal.ansiBrightGreen"]).toBe(blameTerminalTheme.bright.green);
    expect(colors["terminal.ansiBrightYellow"]).toBe(blameTerminalTheme.bright.yellow);
    expect(colors["terminal.ansiBrightBlue"]).toBe(blameTerminalTheme.bright.blue);
    expect(colors["terminal.ansiBrightMagenta"]).toBe(blameTerminalTheme.bright.magenta);
    expect(colors["terminal.ansiBrightCyan"]).toBe(blameTerminalTheme.bright.cyan);
    expect(colors["terminal.ansiBrightWhite"]).toBe(blameTerminalTheme.bright.white);
  });
});

describe("WCAG contrast against the theme background", () => {
  const background = blameTerminalTheme.background;

  it("keeps foreground and each non-black text color at 4.5:1 or higher", () => {
    const textColors: Array<[string, string, number]> = [
      ["foreground", blameTerminalTheme.foreground, 16.12],
      ["red", blameTerminalTheme.normal.red, 7.1],
      ["green", blameTerminalTheme.normal.green, 9.87],
      ["yellow", blameTerminalTheme.normal.yellow, 10.86],
      ["blue", blameTerminalTheme.normal.blue, 8.17],
      ["magenta", blameTerminalTheme.normal.magenta, 7.56],
      ["cyan", blameTerminalTheme.normal.cyan, 11.18],
      ["white", blameTerminalTheme.normal.white, 16.12],
      ["bright red", blameTerminalTheme.bright.red, 8.68],
      ["bright green", blameTerminalTheme.bright.green, 12.45],
      ["bright yellow", blameTerminalTheme.bright.yellow, 12.91],
      ["bright blue", blameTerminalTheme.bright.blue, 10.38],
      ["bright magenta", blameTerminalTheme.bright.magenta, 10.85],
      ["bright cyan", blameTerminalTheme.bright.cyan, 13.38],
      ["bright white", blameTerminalTheme.bright.white, 19.69],
    ];
    for (const [name, hex, expected] of textColors) {
      const ratio = contrastRatio(hex, background);
      expect(ratio, name).toBeGreaterThanOrEqual(4.5);
      expect(roundedRatio(hex, background), name).toBe(expected);
    }
  });

  it("keeps bright black (#5B5986) at 3:1 or higher", () => {
    expect(blameTerminalTheme.bright.black).toBe("#5B5986");
    const ratio = contrastRatio(blameTerminalTheme.bright.black, background);
    expect(ratio).toBeGreaterThanOrEqual(3);
    expect(roundedRatio(blameTerminalTheme.bright.black, background)).toBe(3.02);
  });
});

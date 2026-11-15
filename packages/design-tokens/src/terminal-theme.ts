import { hexToRgb } from "./terminal.js";
import { color, terminalColor } from "./tokens.js";

/**
 * The 8 ANSI hue names shared by the normal and bright palettes in DESIGN.md
 * ("Optional Blame terminal theme").
 */
export const ansiHueNames = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
] as const;

export type AnsiHueName = (typeof ansiHueNames)[number];

/**
 * Optional Blame terminal theme from docs/DESIGN.md.
 * Values that already exist on the design tokens are reused so the theme cannot
 * drift from the token file. Theme-only colors (foreground, magenta, cyan, and
 * most bright slots) stay here.
 */
export const blameTerminalTheme = {
  name: "Blame",
  background: color["bg.base"],
  foreground: "#E8E6FF",
  cursor: color.accent,
  selection: color["bg.raised"],
  normal: {
    black: color["bg.base"],
    red: color["status.error"],
    green: color["status.success"],
    yellow: color["status.warning"],
    blue: color["status.info"],
    magenta: "#B18CFF",
    cyan: "#6ED3D3",
    white: "#E8E6FF",
  },
  bright: {
    black: terminalColor["ansi.brightBlackText"],
    red: "#FF8A8A",
    green: "#6FE3AE",
    yellow: "#FFC95E",
    blue: "#8FBFFF",
    magenta: "#CDB4FF",
    cyan: "#8FE3E3",
    white: color["text.heading"],
  },
} as const;

export type BlameTerminalTheme = typeof blameTerminalTheme;

/** Filenames written under packages/design-tokens/themes/. */
export const themeFilenames = {
  windowsTerminal: "blame.windows-terminal.json",
  iterm: "Blame.itermcolors",
  vscode: "blame.vscode-settings.json",
} as const;

/**
 * Windows Terminal color scheme object. Key names follow
 * https://learn.microsoft.com/en-us/windows/terminal/customize-settings/color-schemes
 * (magenta is `purple` / `brightPurple` in that format).
 */
export function windowsTerminalScheme(): Record<string, string> {
  const { name, background, foreground, cursor, selection, normal, bright } = blameTerminalTheme;
  return {
    name,
    background,
    foreground,
    cursorColor: cursor,
    selectionBackground: selection,
    black: normal.black,
    red: normal.red,
    green: normal.green,
    yellow: normal.yellow,
    blue: normal.blue,
    purple: normal.magenta,
    cyan: normal.cyan,
    white: normal.white,
    brightBlack: bright.black,
    brightRed: bright.red,
    brightGreen: bright.green,
    brightYellow: bright.yellow,
    brightBlue: bright.blue,
    brightPurple: bright.magenta,
    brightCyan: bright.cyan,
    brightWhite: bright.white,
  };
}

export function generateWindowsTerminalScheme(): string {
  return `${JSON.stringify(windowsTerminalScheme(), null, 2)}\n`;
}

const ITERM_ANSI_KEYS = [
  "Ansi 0 Color",
  "Ansi 1 Color",
  "Ansi 2 Color",
  "Ansi 3 Color",
  "Ansi 4 Color",
  "Ansi 5 Color",
  "Ansi 6 Color",
  "Ansi 7 Color",
  "Ansi 8 Color",
  "Ansi 9 Color",
  "Ansi 10 Color",
  "Ansi 11 Color",
  "Ansi 12 Color",
  "Ansi 13 Color",
  "Ansi 14 Color",
  "Ansi 15 Color",
] as const;

/** Stable sRGB component for an iTerm2 `<real>` value, in the 0 to 1 range. */
export function srgbComponentString(byte: number): string {
  const value = byte / 255;
  if (value === 0) return "0";
  if (value === 1) return "1";
  return value.toString();
}

function itermColorDict(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return [
    "\t<dict>",
    "\t\t<key>Alpha Component</key>",
    "\t\t<real>1</real>",
    "\t\t<key>Blue Component</key>",
    `\t\t<real>${srgbComponentString(b)}</real>`,
    "\t\t<key>Color Space</key>",
    "\t\t<string>sRGB</string>",
    "\t\t<key>Green Component</key>",
    `\t\t<real>${srgbComponentString(g)}</real>`,
    "\t\t<key>Red Component</key>",
    `\t\t<real>${srgbComponentString(r)}</real>`,
    "\t</dict>",
  ].join("\n");
}

function itermAnsiHex(index: number): string {
  const hue = ansiHueNames[index % 8];
  if (!hue) throw new Error(`Invalid ANSI index: ${index}`);
  return index < 8 ? blameTerminalTheme.normal[hue] : blameTerminalTheme.bright[hue];
}

/**
 * iTerm2 `.itermcolors` plist. Keys follow the standard color preset format
 * (Ansi 0 to 15 Color, Background Color, Foreground Color, Cursor Color,
 * Selection Color) with float sRGB components and `Color Space` set to sRGB.
 */
export function generateItermcolors(): string {
  const entries: Array<readonly [string, string]> = [
    ...ITERM_ANSI_KEYS.map((key, index) => [key, itermAnsiHex(index)] as const),
    ["Background Color", blameTerminalTheme.background],
    ["Foreground Color", blameTerminalTheme.foreground],
    ["Cursor Color", blameTerminalTheme.cursor],
    ["Selection Color", blameTerminalTheme.selection],
  ];

  const body = entries
    .map(([key, hex]) => `\t<key>${key}</key>\n${itermColorDict(hex)}`)
    .join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    body,
    `</dict>`,
    `</plist>`,
    ``,
  ].join("\n");
}

/**
 * VS Code `settings.json` snippet. Color keys follow
 * https://code.visualstudio.com/api/references/theme-color
 */
export function generateVSCodeSettings(): string {
  const { background, foreground, cursor, selection, normal, bright } = blameTerminalTheme;
  const snippet = {
    "workbench.colorCustomizations": {
      "terminal.background": background,
      "terminal.foreground": foreground,
      "terminalCursor.foreground": cursor,
      "terminal.selectionBackground": selection,
      "terminal.ansiBlack": normal.black,
      "terminal.ansiRed": normal.red,
      "terminal.ansiGreen": normal.green,
      "terminal.ansiYellow": normal.yellow,
      "terminal.ansiBlue": normal.blue,
      "terminal.ansiMagenta": normal.magenta,
      "terminal.ansiCyan": normal.cyan,
      "terminal.ansiWhite": normal.white,
      "terminal.ansiBrightBlack": bright.black,
      "terminal.ansiBrightRed": bright.red,
      "terminal.ansiBrightGreen": bright.green,
      "terminal.ansiBrightYellow": bright.yellow,
      "terminal.ansiBrightBlue": bright.blue,
      "terminal.ansiBrightMagenta": bright.magenta,
      "terminal.ansiBrightCyan": bright.cyan,
      "terminal.ansiBrightWhite": bright.white,
    },
  };
  return `${JSON.stringify(snippet, null, 2)}\n`;
}

export function terminalThemeContents(): Record<
  (typeof themeFilenames)[keyof typeof themeFilenames],
  string
> {
  return {
    [themeFilenames.windowsTerminal]: generateWindowsTerminalScheme(),
    [themeFilenames.iterm]: generateItermcolors(),
    [themeFilenames.vscode]: generateVSCodeSettings(),
  };
}

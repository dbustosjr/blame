import { type AnyColorToken, hex } from "./tokens.js";

/**
 * Terminal color support, in DESIGN.md fallback order:
 * truecolor when COLORTERM is truecolor or 24bit, nearest ANSI 256 otherwise,
 * plain ANSI 16 as the final fallback. "none" means plain text (NO_COLOR or not a TTY).
 */
export type ColorLevel = "none" | "ansi16" | "ansi256" | "truecolor";

export interface ColorEnv {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly isTTY: boolean;
}

/**
 * NO_COLOR is honored when it is present and not empty (https://no-color.org).
 */
export function isNoColor(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env.NO_COLOR;
  return value !== undefined && value !== "";
}

export function detectColorLevel({ env, isTTY }: ColorEnv): ColorLevel {
  if (isNoColor(env) || !isTTY || env.TERM === "dumb") return "none";
  const colorterm = (env.COLORTERM ?? "").toLowerCase();
  if (colorterm === "truecolor" || colorterm === "24bit") return "truecolor";
  if ((env.TERM ?? "").includes("256")) return "ansi256";
  return "ansi16";
}

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function hexToRgb(value: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match?.[1]) throw new Error(`Not a #RRGGBB color: ${value}`);
  const n = Number.parseInt(match[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

const CUBE_STEPS = [0, 95, 135, 175, 215, 255] as const;

function distance(a: Rgb, b: Rgb): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}

function nearestCubeIndex(channel: number): number {
  let best = 0;
  for (let i = 1; i < CUBE_STEPS.length; i++) {
    if (Math.abs((CUBE_STEPS[i] ?? 0) - channel) < Math.abs((CUBE_STEPS[best] ?? 0) - channel)) {
      best = i;
    }
  }
  return best;
}

/** Nearest xterm 256 palette index (6x6x6 cube or grayscale ramp) for a hex color. */
export function nearestAnsi256(value: string): number {
  const rgb = hexToRgb(value);
  const ri = nearestCubeIndex(rgb.r);
  const gi = nearestCubeIndex(rgb.g);
  const bi = nearestCubeIndex(rgb.b);
  const cube: Rgb = { r: CUBE_STEPS[ri] ?? 0, g: CUBE_STEPS[gi] ?? 0, b: CUBE_STEPS[bi] ?? 0 };
  const cubeIndex = 16 + 36 * ri + 6 * gi + bi;

  const avg = (rgb.r + rgb.g + rgb.b) / 3;
  const grayStep = Math.max(0, Math.min(23, Math.round((avg - 8) / 10)));
  const grayValue = 8 + 10 * grayStep;
  const gray: Rgb = { r: grayValue, g: grayValue, b: grayValue };
  const grayIndex = 232 + grayStep;

  return distance(rgb, gray) < distance(rgb, cube) ? grayIndex : cubeIndex;
}

/** The 16 ANSI color names, by SGR foreground code. */
export const ansi16Codes = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  brightBlack: 90,
  brightRed: 91,
  brightGreen: 92,
  brightYellow: 93,
  brightBlue: 94,
  brightMagenta: 95,
  brightCyan: 96,
  brightWhite: 97,
} as const;

export type Ansi16Name = keyof typeof ansi16Codes;

/**
 * One ANSI 16 style: a named color, or null for the terminal's default foreground (no color
 * code). Bold and dim come from DESIGN.md and are applied only in 16-color mode. Background
 * tokens use color null: Blame never sets a background, so the user's theme stays readable.
 */
export interface Ansi16Style {
  readonly color: Ansi16Name | null;
  readonly bold?: boolean;
  readonly dim?: boolean;
}

/**
 * ANSI 16 fallback per token, from the "Terminal ANSI 16" table in DESIGN.md.
 * White and bright white are never used for text: they disappear on light themes.
 */
export const ansi16: Readonly<Record<AnyColorToken, Ansi16Style>> = {
  "bg.base": { color: null },
  "bg.panel": { color: null },
  "bg.raised": { color: null },
  accent: { color: "brightBlue" },
  "text.heading": { color: null, bold: true },
  "text.primary": { color: null },
  "text.secondary": { color: null, dim: true },
  "text.muted": { color: "brightBlack" },
  "text.disabled": { color: "brightBlack" },
  "border.subtle": { color: "brightBlack" },
  "border.strong": { color: "brightBlack" },
  "border.control": { color: "blue" },
  "status.success": { color: "green" },
  "status.warning": { color: "yellow" },
  "status.error": { color: "red" },
  "status.info": { color: "cyan" },
  "trust.L0": { color: "brightBlack" },
  "trust.L1": { color: "magenta" },
  "trust.L2": { color: "brightMagenta" },
  "trust.L3": { color: "brightBlue" },
  "trust.L4": { color: null, bold: true },
  "ansi.brightBlack": { color: "brightBlack" },
  "ansi.brightBlackText": { color: "brightBlack" },
};

const ESC = "\u001b[";

/** SGR open sequence for a foreground token at a color level. Empty string means no color. */
export function fgSequence(token: AnyColorToken, level: ColorLevel): string {
  switch (level) {
    case "none":
      return "";
    case "truecolor": {
      const { r, g, b } = hexToRgb(hex(token));
      return `${ESC}38;2;${r};${g};${b}m`;
    }
    case "ansi256":
      return `${ESC}38;5;${nearestAnsi256(hex(token))}m`;
    case "ansi16": {
      const name = ansi16[token].color;
      return name ? `${ESC}${ansi16Codes[name]}m` : "";
    }
  }
}

/** SGR open sequence for a background token at a color level. Empty string means no color. */
export function bgSequence(token: AnyColorToken, level: ColorLevel): string {
  switch (level) {
    case "none":
      return "";
    case "truecolor": {
      const { r, g, b } = hexToRgb(hex(token));
      return `${ESC}48;2;${r};${g};${b}m`;
    }
    case "ansi256":
      return `${ESC}48;5;${nearestAnsi256(hex(token))}m`;
    case "ansi16": {
      const name = ansi16[token].color;
      return name ? `${ESC}${ansi16Codes[name] + 10}m` : "";
    }
  }
}

export const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;

export interface PaintOptions {
  readonly bold?: boolean;
}

/** SGR open sequence for a token in 16-color mode, including bold and dim from DESIGN.md. */
function ansi16Open(token: AnyColorToken, options: PaintOptions): string {
  const style = ansi16[token];
  const bold = Boolean(options.bold || style.bold);
  const dim = Boolean(style.dim);
  const color = style.color ? `${ESC}${ansi16Codes[style.color]}m` : "";
  return `${bold ? BOLD : ""}${dim ? DIM : ""}${color}`;
}

/** Wrap text in a token color. At level "none" the text comes back unchanged. */
export function paint(
  text: string,
  token: AnyColorToken,
  level: ColorLevel,
  options: PaintOptions = {},
): string {
  if (level === "none") return text;
  const open =
    level === "ansi16"
      ? ansi16Open(token, options)
      : `${options.bold ? BOLD : ""}${fgSequence(token, level)}`;
  return open ? `${open}${text}${RESET}` : text;
}

/** Strip SGR escape sequences, for width math and plain output checks. */
export function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ESC is the point
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

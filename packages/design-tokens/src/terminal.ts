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
 * ANSI 16 fallback per token. DESIGN.md refers to a BRAND.md mapping that is not in the repo yet,
 * so this mapping is a Phase 0 assumption to confirm with Davinci. Background tokens map to null:
 * in 16 color mode Blame keeps the user's terminal background.
 */
export const ansi16: Readonly<Record<AnyColorToken, Ansi16Name | null>> = {
  "bg.base": null,
  "bg.panel": null,
  "bg.raised": null,
  accent: "brightBlue",
  "text.heading": "brightWhite",
  "text.primary": "brightWhite",
  "text.secondary": "white",
  "text.muted": "white",
  "text.disabled": "brightBlack",
  "border.subtle": "brightBlack",
  "border.strong": "brightBlack",
  "border.control": "blue",
  "status.success": "green",
  "status.warning": "yellow",
  "status.error": "red",
  "status.info": "cyan",
  "trust.L0": "white",
  "trust.L1": "magenta",
  "trust.L2": "brightMagenta",
  "trust.L3": "brightBlue",
  "trust.L4": "brightWhite",
  "ansi.brightBlack": "brightBlack",
  "ansi.brightBlackText": "brightBlack",
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
      const name = ansi16[token];
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
      const name = ansi16[token];
      return name ? `${ESC}${ansi16Codes[name] + 10}m` : "";
    }
  }
}

export const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;

export interface PaintOptions {
  readonly bold?: boolean;
}

/** Wrap text in a token color. At level "none" the text comes back unchanged. */
export function paint(
  text: string,
  token: AnyColorToken,
  level: ColorLevel,
  options: PaintOptions = {},
): string {
  if (level === "none") return text;
  const open = `${options.bold ? BOLD : ""}${fgSequence(token, level)}`;
  return open ? `${open}${text}${RESET}` : text;
}

/** Strip SGR escape sequences, for width math and plain output checks. */
export function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ESC is the point
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

/**
 * Design tokens from docs/DESIGN.md. DESIGN.md is the source of truth; a unit test parses it
 * and fails if any value here drifts. Change DESIGN.md first, then this file.
 */

export const color = {
  "bg.base": "#04052E",
  "bg.panel": "#140152",
  "bg.raised": "#22007C",
  accent: "#B9C2FF",
  "text.heading": "#FFFFFF",
  "text.primary": "#F2F0FF",
  "text.secondary": "#A9A7CC",
  "text.muted": "#8A88AA",
  "text.disabled": "#6E6C94",
  "border.subtle": "#26245F",
  "border.strong": "#3B3790",
  "border.control": "#5A5AAC",
  "status.success": "#3ECF8E",
  "status.warning": "#F5B544",
  "status.error": "#FF6B6B",
  "status.info": "#6EA8FF",
} as const;

export type ColorToken = keyof typeof color;

/**
 * Trust ramp, L0 to L4. Brightens in order and never reuses a status color.
 * Always pair a trust color with its label, never color alone (DESIGN.md).
 */
export const trust = {
  L0: "#8A88AA",
  L1: "#8B7CFF",
  L2: "#A29FFF",
  L3: "#B9C2FF",
  L4: "#FFFFFF",
} as const;

export type TrustToken = keyof typeof trust;

/** Terminal-only colors called out in DESIGN.md accessibility fixes. */
export const terminalColor = {
  /** Bright black. Decoration only, such as box borders (2.33:1). */
  "ansi.brightBlack": "#4A4878",
  /** Minimum for terminal text users must read that would otherwise be bright black. */
  "ansi.brightBlackText": "#5B5986",
} as const;

export type TerminalColorToken = keyof typeof terminalColor;

export const font = {
  sans: ["Inter", "system-ui", "sans-serif"],
  mono: ["JetBrains Mono", "ui-monospace", "monospace"],
} as const;

/** Type scale in rem. */
export const fontSize = [0.75, 0.875, 1, 1.125, 1.25, 1.5, 2, 2.75, 3.5] as const;

export const fontWeight = { body: 400, label: 500, heading: 600 } as const;

export const lineHeight = { body: 1.6, heading: 1.15 } as const;

/** Spacing steps in px (4px base). */
export const space = [4, 8, 12, 16, 24, 32, 48, 64, 96, 128] as const;

/** Radius in px. */
export const radius = { control: 6, card: 10, panel: 14, pill: 999 } as const;

/** Motion durations in ms, ease-out. */
export const motion = { press: 120, panel: 200, easing: "ease-out" } as const;

export const focusRing = { width: 2, offset: 2, color: "accent" as ColorToken } as const;

export const layout = { maxContentWidth: 1200, columns: 12 } as const;

/** Prompt mark glyphs: the logo's bar and chevron, with an ASCII fallback. */
export const promptMark = { unicode: "\u258F\u203A", ascii: "|>" } as const;

/** Any token that resolves to a hex color. */
export type AnyColorToken = ColorToken | `trust.${TrustToken}` | TerminalColorToken;

export function hex(token: AnyColorToken): string {
  if (token.startsWith("trust.")) {
    return trust[token.slice("trust.".length) as TrustToken];
  }
  if (token in terminalColor) {
    return terminalColor[token as TerminalColorToken];
  }
  return color[token as ColorToken];
}

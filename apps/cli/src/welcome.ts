import { defaultPolicy } from "@blame-ai/core";
import type { TrustToken } from "@blame-ai/design-tokens";
import { stripAnsi, type Theme } from "./theme.js";

export interface WelcomeOptions {
  readonly theme: Theme;
  readonly cwd: string;
  readonly mode: string;
  readonly version: string;
  /** Terminal width in columns. The box never exceeds it and works at 80. */
  readonly columns?: number;
}

const BORDERS = {
  unicode: { tl: "\u256D", tr: "\u256E", bl: "\u2570", br: "\u256F", h: "\u2500", v: "\u2502" },
  ascii: { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" },
} as const;

function truncateMiddle(text: string, max: number, ellipsis: string): string {
  if (text.length <= max) return text;
  const keep = max - ellipsis.length;
  const head = Math.ceil(keep / 2);
  return `${text.slice(0, head)}${ellipsis}${text.slice(text.length - (keep - head))}`;
}

/**
 * Welcome box from DESIGN.md: rounded border in border.strong, the wordmark in accent, the working
 * directory, the autonomy mode (colored by the preset's trust ceiling, always with its label) and
 * tips in muted text.
 */
export function renderWelcome(options: WelcomeOptions): string {
  const { theme } = options;
  const b = theme.unicode ? BORDERS.unicode : BORDERS.ascii;
  const width = Math.max(40, Math.min(options.columns ?? 80, 80));
  const inner = width - 4;
  const ellipsis = theme.unicode ? "\u2026" : "...";

  const preset = defaultPolicy.presets.find((p) => p.id === options.mode);
  const label = preset?.label ?? options.mode;
  const ceiling = (preset?.ceiling ?? "L0") as TrustToken;

  const lines: string[] = [
    `${theme.role("promptMark", theme.promptMark)} ${theme.role("wordmark", "Blame", { bold: true })} ${theme.role("hint", `v${options.version}`)}`,
    "",
    `${theme.role("hint", "cwd:")} ${truncateMiddle(options.cwd, inner - 5, ellipsis)}`,
    `${theme.role("hint", "mode:")} ${theme.token(`trust.${ceiling}`, `${label} (${ceiling})`)}`,
    "",
    theme.role("hint", "Tips: shift+tab cycles Manual, Guided and Autonomous"),
    theme.role("hint", "      /mode switches presets, ? shows shortcuts"),
  ];

  const border = (s: string) => theme.role("welcomeBorder", s);
  const out = [border(`${b.tl}${b.h.repeat(width - 2)}${b.tr}`)];
  for (const line of lines) {
    const pad = Math.max(0, inner - stripAnsi(line).length);
    out.push(`${border(b.v)} ${line}${" ".repeat(pad)} ${border(b.v)}`);
  }
  out.push(border(`${b.bl}${b.h.repeat(width - 2)}${b.br}`));
  return `${out.join("\n")}\n`;
}

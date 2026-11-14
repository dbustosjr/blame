/**
 * Terminal theme for the CLI. Every color comes from @blame-ai/design-tokens so the terminal,
 * the extension and the website cannot drift. This module only names terminal roles.
 */
import {
  type AnyColorToken,
  type ColorLevel,
  detectColorLevel,
  paint,
  promptMark,
} from "@blame-ai/design-tokens";

export {
  type ColorLevel,
  detectColorLevel,
  isNoColor,
  paint,
  stripAnsi,
} from "@blame-ai/design-tokens";

/** Terminal roles from DESIGN.md "Terminal app", mapped to tokens. */
export const terminalRoles = {
  welcomeBorder: "border.strong",
  wordmark: "accent",
  promptMark: "accent",
  toolBullet: "accent",
  spinner: "accent",
  userTurn: "text.secondary",
  assistantText: "text.primary",
  hint: "text.muted",
  toolArgs: "text.muted",
  diffAdded: "status.success",
  diffRemoved: "status.error",
} as const satisfies Record<string, AnyColorToken>;

export type TerminalRole = keyof typeof terminalRoles;

export interface Theme {
  readonly level: ColorLevel;
  readonly unicode: boolean;
  role(role: TerminalRole, text: string, options?: { bold?: boolean }): string;
  token(token: AnyColorToken, text: string, options?: { bold?: boolean }): string;
  readonly promptMark: string;
}

export function createTheme(level: ColorLevel, unicode = true): Theme {
  return {
    level,
    unicode,
    role: (role, text, options) => paint(text, terminalRoles[role], level, options),
    token: (token, text, options) => paint(text, token, level, options),
    promptMark: unicode ? promptMark.unicode : promptMark.ascii,
  };
}

/** Theme for the current process: honors NO_COLOR, non-TTY output and COLORTERM. */
export function themeForProcess(stream: { isTTY?: boolean } = process.stdout): Theme {
  return createTheme(detectColorLevel({ env: process.env, isTTY: stream.isTTY === true }));
}

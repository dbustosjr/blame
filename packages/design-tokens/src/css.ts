import { color, focusRing, font, radius, trust } from "./tokens.js";

function varName(token: string): string {
  return `--blame-${token.replace(/\./g, "-")}`;
}

/**
 * CSS custom properties for the website and the extension webviews, for example
 * `--blame-bg-base` and `--blame-trust-L2`.
 */
export function cssVariables(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [token, value] of Object.entries(color)) vars[varName(token)] = value;
  for (const [level, value] of Object.entries(trust)) vars[varName(`trust.${level}`)] = value;
  vars["--blame-radius-control"] = `${radius.control}px`;
  vars["--blame-radius-card"] = `${radius.card}px`;
  vars["--blame-radius-panel"] = `${radius.panel}px`;
  vars["--blame-radius-pill"] = `${radius.pill}px`;
  vars["--blame-focus-ring-width"] = `${focusRing.width}px`;
  vars["--blame-focus-ring-offset"] = `${focusRing.offset}px`;
  vars["--blame-font-mono"] = font.mono.map((f) => (f.includes(" ") ? `"${f}"` : f)).join(", ");
  return vars;
}

/** The same variables as a CSS rule body, for a `:root { ... }` block. */
export function cssVariablesBlock(selector = ":root"): string {
  const lines = Object.entries(cssVariables()).map(([k, v]) => `  ${k}: ${v};`);
  return `${selector} {\n${lines.join("\n")}\n}\n`;
}

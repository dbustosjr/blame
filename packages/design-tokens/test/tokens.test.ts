import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type Ansi16Name,
  type Ansi16Style,
  ansi16,
  bgSequence,
  color,
  cssVariables,
  detectColorLevel,
  fgSequence,
  hex,
  isNoColor,
  nearestAnsi256,
  paint,
  stripAnsi,
  terminalColor,
  trust,
} from "../src/index.js";

const designMd = readFileSync(
  fileURLToPath(new URL("../../../docs/DESIGN.md", import.meta.url)),
  "utf8",
);

/** Rows like: | `bg.base` | #04052E | ... */
function tokenRows(): Map<string, string> {
  const rows = new Map<string, string>();
  for (const match of designMd.matchAll(
    /^\|\s*`([a-zA-Z0-9.]+)`\s*\|\s*(#[0-9A-Fa-f]{6})\s*\|/gm,
  )) {
    const [, name, value] = match;
    if (name && value) rows.set(name, value.toUpperCase());
  }
  return rows;
}

const ANSI16_COLOR_NAMES: Record<string, Ansi16Name> = {
  "bright black": "brightBlack",
  "bright red": "brightRed",
  "bright green": "brightGreen",
  "bright yellow": "brightYellow",
  "bright blue": "brightBlue",
  "bright magenta": "brightMagenta",
  "bright cyan": "brightCyan",
  "bright white": "brightWhite",
  black: "black",
  red: "red",
  green: "green",
  yellow: "yellow",
  blue: "blue",
  magenta: "magenta",
  cyan: "cyan",
  white: "white",
};

function parseAnsi16Style(value: string): Ansi16Style {
  const lower = value.toLowerCase();
  const style: { color: Ansi16Name | null; bold?: boolean; dim?: boolean } = { color: null };
  if (/\bbold\b/.test(lower)) style.bold = true;
  if (/\bdim\b/.test(lower)) style.dim = true;
  if (/\bnone\b/.test(lower) || lower.includes("default foreground")) return style;
  const key = Object.keys(ANSI16_COLOR_NAMES)
    .sort((a, b) => b.length - a.length)
    .find((name) => lower.includes(name));
  if (!key) throw new Error(`Cannot parse ANSI 16 style: ${value}`);
  style.color = ANSI16_COLOR_NAMES[key] ?? null;
  return style;
}

/** Rows from the Terminal ANSI 16 table in DESIGN.md. */
function ansi16DocRows(): Map<string, Ansi16Style> {
  const section = designMd.split("## Terminal ANSI 16")[1] ?? "";
  const table = section.split("### Optional")[0] ?? section;
  const rows = new Map<string, Ansi16Style>();
  for (const line of table.split("\n")) {
    const match = /^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/.exec(line);
    if (!match?.[1] || !match[2]) continue;
    const tokensCell = match[1];
    const valueCell = match[2];
    if (tokensCell.includes("Token") || tokensCell.includes("---")) continue;
    const tokens: string[] = [];
    for (const token of tokensCell.matchAll(/`([a-zA-Z0-9.]+)`/g)) {
      if (token[1]) tokens.push(token[1]);
    }
    for (const level of tokensCell.matchAll(/trust\s+(L[0-4])/g)) {
      if (level[1]) tokens.push(`trust.${level[1]}`);
    }
    const style = parseAnsi16Style(valueCell);
    for (const token of tokens) rows.set(token, style);
  }
  return rows;
}

describe("tokens match docs/DESIGN.md", () => {
  const rows = tokenRows();

  it("finds the color and trust tables", () => {
    expect(rows.size).toBe(Object.keys(color).length + Object.keys(trust).length);
  });

  it("has every color token with the DESIGN.md value", () => {
    const fromDoc = Object.fromEntries([...rows].filter(([name]) => !name.startsWith("trust.")));
    expect(color).toEqual(fromDoc);
  });

  it("has the trust ramp with the DESIGN.md values", () => {
    const fromDoc = Object.fromEntries(
      [...rows]
        .filter(([name]) => name.startsWith("trust."))
        .map(([name, value]) => [name.slice("trust.".length), value]),
    );
    expect(trust).toEqual(fromDoc);
  });

  it("uses the terminal bright black values from the accessibility fixes", () => {
    expect(designMd).toContain(`bright black ${terminalColor["ansi.brightBlack"]}`);
    expect(designMd).toContain(`uses ${terminalColor["ansi.brightBlackText"]} or brighter`);
  });

  it("trust ramp brightens in order and never reuses a status color", () => {
    // WCAG relative luminance, the same measure DESIGN.md uses for its contrast table.
    const luminance = (h: string) => {
      const n = Number.parseInt(h.slice(1), 16);
      const lin = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    };
    const ramp = Object.values(trust).map(luminance);
    expect([...ramp].sort((a, b) => a - b)).toEqual(ramp);
    const statuses = [
      color["status.success"],
      color["status.warning"],
      color["status.error"],
      color["status.info"],
    ];
    for (const value of Object.values(trust)) expect(statuses).not.toContain(value);
  });

  it("has an ANSI 16 mapping that matches the Terminal ANSI 16 table", () => {
    const fromDoc = ansi16DocRows();
    const documented = [
      ...Object.keys(color),
      ...Object.keys(trust).map((level) => `trust.${level}`),
    ];
    expect([...fromDoc.keys()].sort()).toEqual([...documented].sort());
    for (const [token, style] of fromDoc) {
      expect(ansi16[token as keyof typeof ansi16]).toEqual(style);
    }
  });
});

describe("color level detection", () => {
  it("honors NO_COLOR when present and not empty", () => {
    expect(isNoColor({ NO_COLOR: "1" })).toBe(true);
    expect(isNoColor({ NO_COLOR: "" })).toBe(false);
    expect(isNoColor({})).toBe(false);
    expect(detectColorLevel({ env: { NO_COLOR: "1", COLORTERM: "truecolor" }, isTTY: true })).toBe(
      "none",
    );
  });

  it("is plain when not a TTY", () => {
    expect(detectColorLevel({ env: { COLORTERM: "truecolor" }, isTTY: false })).toBe("none");
  });

  it("falls back truecolor, then 256, then 16", () => {
    expect(detectColorLevel({ env: { COLORTERM: "truecolor" }, isTTY: true })).toBe("truecolor");
    expect(detectColorLevel({ env: { COLORTERM: "24bit" }, isTTY: true })).toBe("truecolor");
    expect(detectColorLevel({ env: { TERM: "xterm-256color" }, isTTY: true })).toBe("ansi256");
    expect(detectColorLevel({ env: { TERM: "xterm" }, isTTY: true })).toBe("ansi16");
  });
});

describe("terminal sequences", () => {
  it("emits truecolor from the hex value", () => {
    expect(fgSequence("accent", "truecolor")).toBe("\u001b[38;2;185;194;255m");
    expect(bgSequence("bg.base", "truecolor")).toBe("\u001b[48;2;4;5;46m");
  });

  it("maps to the nearest 256 color", () => {
    expect(nearestAnsi256("#FFFFFF")).toBe(231);
    expect(nearestAnsi256("#000000")).toBe(16);
    expect(fgSequence("status.error", "ansi256")).toBe("\u001b[38;5;203m");
  });

  it("has an ANSI 16 entry for every token", () => {
    for (const token of Object.keys(color)) expect(token in ansi16).toBe(true);
    for (const level of Object.keys(trust)) expect(`trust.${level}` in ansi16).toBe(true);
    expect(fgSequence("status.success", "ansi16")).toBe("\u001b[32m");
    expect(bgSequence("bg.base", "ansi16")).toBe("");
  });

  it("uses the default foreground, bold and dim in 16-color mode so text stays readable on light themes", () => {
    expect(fgSequence("text.primary", "ansi16")).toBe("");
    expect(fgSequence("text.heading", "ansi16")).toBe("");
    expect(fgSequence("trust.L4", "ansi16")).toBe("");
    expect(fgSequence("text.secondary", "ansi16")).toBe("");
    expect(paint("Body", "text.primary", "ansi16")).toBe("Body");
    expect(paint("Title", "text.heading", "ansi16")).toBe("\u001b[1mTitle\u001b[0m");
    expect(paint("Max", "trust.L4", "ansi16")).toBe("\u001b[1mMax\u001b[0m");
    expect(paint("Hint", "text.secondary", "ansi16")).toBe("\u001b[2mHint\u001b[0m");
    expect(paint("Muted", "text.muted", "ansi16")).toBe("\u001b[90mMuted\u001b[0m");
    expect(paint("Off", "text.disabled", "ansi16")).toBe("\u001b[90mOff\u001b[0m");
    expect(paint("Low", "trust.L0", "ansi16")).toBe("\u001b[90mLow\u001b[0m");
    expect(paint("Title", "text.heading", "ansi16", { bold: true })).toBe(
      "\u001b[1mTitle\u001b[0m",
    );
    expect(ansi16["text.muted"].color).toBe("brightBlack");
    expect(ansi16["trust.L0"].color).toBe("brightBlack");
    const textTokens = [
      "text.heading",
      "text.primary",
      "text.secondary",
      "text.muted",
      "text.disabled",
      "trust.L0",
      "trust.L4",
    ] as const;
    for (const token of textTokens) {
      expect(ansi16[token].color).not.toBe("white");
      expect(ansi16[token].color).not.toBe("brightWhite");
    }
  });

  it("paints nothing at level none, including heading bold and secondary dim", () => {
    expect(paint("hi", "accent", "none")).toBe("hi");
    expect(paint("Title", "text.heading", "none")).toBe("Title");
    expect(paint("Hint", "text.secondary", "none")).toBe("Hint");
    expect(paint("Max", "trust.L4", "none", { bold: true })).toBe("Max");
    expect(stripAnsi(paint("hi", "accent", "truecolor", { bold: true }))).toBe("hi");
  });

  it("emits no SGR when NO_COLOR is set", () => {
    const level = detectColorLevel({ env: { NO_COLOR: "1", COLORTERM: "truecolor" }, isTTY: true });
    expect(level).toBe("none");
    expect(paint("Title", "text.heading", level)).toBe("Title");
    expect(paint("Body", "text.primary", level)).toBe("Body");
    expect(paint("Hint", "text.secondary", level)).toBe("Hint");
    expect(paint("Low", "trust.L0", level)).toBe("Low");
    expect(paint("Max", "trust.L4", level, { bold: true })).toBe("Max");
  });

  it("resolves trust and terminal tokens", () => {
    expect(hex("trust.L2")).toBe(trust.L2);
    expect(hex("ansi.brightBlack")).toBe("#4A4878");
  });
});

describe("css variables", () => {
  it("exports every color and trust token", () => {
    const vars = cssVariables();
    expect(vars["--blame-bg-base"]).toBe(color["bg.base"]);
    expect(vars["--blame-trust-L4"]).toBe(trust.L4);
    expect(vars["--blame-text-muted"]).toBe(color["text.muted"]);
  });
});

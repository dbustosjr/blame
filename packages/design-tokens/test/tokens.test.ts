import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
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

  it("paints nothing at level none", () => {
    expect(paint("hi", "accent", "none")).toBe("hi");
    expect(stripAnsi(paint("hi", "accent", "truecolor", { bold: true }))).toBe("hi");
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

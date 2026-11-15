/**
 * Fidelity-preserving wrapping for the approval box: paths, the reason, and the protocol's coming
 * `command` field. What the box shows must be exactly what is being approved, so:
 * - Nothing is collapsed, trimmed or clipped. Joining the wrapped lines (without the inserted
 *   breaks) gives back the shown text exactly, spaces included.
 * - Control characters (C0, DEL, C1) and characters that can hide or reorder text (bidi controls,
 *   zero-width, BOM, line and paragraph separators) are shown escaped (`\t`, `\x1b`, `\u{202e}`),
 *   never sent to the terminal, so nothing can move the cursor, recolor or rewrite the box.
 * Literal backslashes are left as they are (Windows paths); width counts UTF-16 code units.
 */

const NAMED: Readonly<Record<string, string>> = { "\t": "\\t", "\n": "\\n", "\r": "\\r" };
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const INVISIBLE = /[\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/;

/** One character as it is shown: itself, or a visible escape. */
function shown(ch: string): string {
  const named = NAMED[ch];
  if (named !== undefined) return named;
  const code = ch.codePointAt(0) ?? 0;
  if (CONTROL.test(ch)) return `\\x${code.toString(16).padStart(2, "0")}`;
  if (INVISIBLE.test(ch)) return `\\u{${code.toString(16)}}`;
  return ch;
}

/** The text with every control or invisible character escaped. */
export function escapeControl(text: string): string {
  let out = "";
  for (const ch of text) out += shown(ch);
  return out;
}

/**
 * Wraps `text` (escaped first) to at most `width` columns. Breaks after an existing space where it
 * can, then after `/` or `\`, and hard-breaks a token with neither. An escape stays on one line
 * unless it is wider than the line itself.
 */
export function wrapText(text: string, width: number): string[] {
  const max = Math.max(1, Math.floor(width));
  const units: string[] = [];
  for (const ch of text) {
    const unit = shown(ch);
    if (unit.length <= max) units.push(unit);
    else for (const part of unit) units.push(part);
  }
  if (units.length === 0) return [""];

  const lines: string[] = [];
  let line: string[] = [];
  let length = 0;
  for (const unit of units) {
    if (length + unit.length > max && line.length > 0) {
      // Prefer the last space, then the last slash, in the current line; cut just after it.
      let cut = findLast(line, (u) => u === " ");
      if (cut < 0) cut = findLast(line, (u) => u === "/" || u === "\\");
      const keep = cut >= 0 ? line.slice(0, cut + 1) : line;
      const carry = cut >= 0 ? line.slice(cut + 1) : [];
      lines.push(keep.join(""));
      line = carry;
      length = carry.reduce((n, u) => n + u.length, 0);
    }
    line.push(unit);
    length += unit.length;
  }
  lines.push(line.join(""));
  return lines;
}

function findLast(items: readonly string[], test: (item: string) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (test(items[i] as string)) return i;
  return -1;
}

/** `label value`, wrapped to `width`, with continuation lines indented under the value. */
export function wrapField(label: string, value: string, width: number): string[] {
  const indent = label.length + 1;
  const room = Math.max(1, width - indent);
  return wrapText(value, room).map((part, i) =>
    i === 0 ? `${label} ${part}` : `${" ".repeat(indent)}${part}`,
  );
}

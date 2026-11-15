/**
 * Strips terminal control from text Blame did not write itself (model text, engine errors, block
 * reasons) before it reaches the terminal: CSI (ESC [ and C1 0x9B), OSC (ESC ] and 0x9D, ended by
 * BEL or ST), DCS, SOS, PM and APC strings (ESC P X ^ _ and C1 0x90 0x98 0x9E 0x9F, ended by ST),
 * other escapes and lone ESC, and every other C0 or C1 control. Only \n and \t are kept.
 * Stateful, so a sequence split across chunks is still removed.
 */
export interface TerminalSanitizer {
  push(text: string): string;
  /** Ends the stream; an unfinished sequence is dropped. */
  flush(): string;
}

type State = "text" | "esc" | "escInter" | "csi" | "string" | "stringEsc";

const ESC = 0x1b;
const BEL = 0x07;

export function createTerminalSanitizer(): TerminalSanitizer {
  let state: State = "text";
  return {
    push(text) {
      let out = "";
      for (const ch of text) {
        const c = ch.codePointAt(0) ?? 0;
        switch (state) {
          case "text":
            if (c === ESC) state = "esc";
            else if (c === 0x9b) state = "csi";
            else if (c === 0x9d || c === 0x90 || c === 0x98 || c === 0x9e || c === 0x9f) {
              state = "string";
            } else if (ch === "\n" || ch === "\t") out += ch;
            else if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) {
              // Other control characters are dropped.
            } else out += ch;
            break;
          case "esc":
            if (ch === "[") state = "csi";
            else if (ch === "]" || ch === "P" || ch === "X" || ch === "^" || ch === "_") {
              state = "string";
            } else if (c >= 0x20 && c <= 0x2f) state = "escInter";
            else if (c === ESC) state = "esc";
            else state = "text"; // ESC + final byte (or anything else): both dropped.
            break;
          case "escInter":
            if (c >= 0x30 && c <= 0x7e) state = "text";
            else if (c === ESC) state = "esc";
            break;
          case "csi":
            // Parameters and intermediates (0x20-0x3F) until a final byte (0x40-0x7E).
            if (c >= 0x40 && c <= 0x7e) state = "text";
            else if (c === ESC) state = "esc";
            else if (c < 0x20 || c > 0x7e) state = "text";
            break;
          case "string":
            if (c === BEL || c === 0x9c) state = "text";
            else if (c === ESC) state = "stringEsc";
            break;
          case "stringEsc":
            state = ch === "\\" ? "text" : "string";
            break;
        }
      }
      return out;
    },
    flush() {
      state = "text";
      return "";
    },
  };
}

/** One-shot sanitizing for a whole string (an error message, a block reason). */
export function sanitizeForTerminal(text: string): string {
  const s = createTerminalSanitizer();
  return s.push(text) + s.flush();
}

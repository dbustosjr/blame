/**
 * Wraps text to `width` columns without losing anything: breaks on spaces first, then after `/`
 * or `\` in long paths, and hard-breaks only a run with no break point. Used by the approval box
 * for paths and reasons, and meant for the protocol's coming `command` field too (nothing may
 * look complete when it is not, so nothing is clipped).
 */
export function wrapText(text: string, width: number): string[] {
  const max = Math.max(1, Math.floor(width));
  if (text === "") return [""];
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/ +/).filter((w) => w !== "")) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (candidate.length <= max) {
        line = candidate;
        continue;
      }
      if (line !== "") lines.push(line);
      line = "";
      const pieces = breakWord(word, max);
      lines.push(...pieces.slice(0, -1));
      line = pieces.at(-1) ?? "";
    }
    lines.push(line);
  }
  return lines;
}

/** Splits one word into pieces of at most `max`, preferring to end a piece just after a slash. */
function breakWord(word: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = word;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const slash = Math.max(window.lastIndexOf("/"), window.lastIndexOf("\\"));
    const cut = slash > 0 ? slash + 1 : max;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  pieces.push(rest);
  return pieces;
}

/** `label value`, wrapped to `width`, with continuation lines indented under the value. */
export function wrapField(label: string, value: string, width: number): string[] {
  const indent = label.length + 1;
  const room = Math.max(1, width - indent);
  return wrapText(value, room).map((part, i) =>
    i === 0 ? `${label} ${part}` : `${" ".repeat(indent)}${part}`,
  );
}

/** C0 and C1 control characters in `text`, except the ones listed in `keep`. */
export function controlChars(text: string, keep = ""): string[] {
  return [...text].filter((ch) => {
    const c = ch.codePointAt(0) ?? 0;
    return (c < 0x20 || (c >= 0x7f && c <= 0x9f)) && !keep.includes(ch);
  });
}

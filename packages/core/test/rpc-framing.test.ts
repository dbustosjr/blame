import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { attachJsonlReader, createJsonlDecoder, serializeJsonLine } from "../src/index.js";

function collect(maxLineLength?: number) {
  const lines: string[] = [];
  const errors: { code: string; length: number }[] = [];
  const decoder = createJsonlDecoder({
    onLine: (line) => lines.push(line),
    onOversized: (length) => errors.push({ code: "line_too_long", length }),
    ...(maxLineLength === undefined ? {} : { maxLineLength }),
  });
  return { decoder, lines, errors };
}

describe("serializeJsonLine", () => {
  it("writes one JSON object ended by LF and keeps U+2028 and U+2029 inside the string", () => {
    const line = serializeJsonLine({ text: "a\u2028b\u2029c\nd" });
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({ text: "a\u2028b\u2029c\nd" });
  });
});

describe("createJsonlDecoder", () => {
  it("joins records split across chunks", () => {
    const { decoder, lines } = collect();
    decoder.push('{"a":');
    decoder.push("1}\n{");
    decoder.push('"b":2}\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("strips one trailing CR (CRLF framing)", () => {
    const { decoder, lines } = collect();
    decoder.push('{"a":1}\r\n{"b":2}\r\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("splits on LF only, not on U+2028 or U+2029", () => {
    const { decoder, lines } = collect();
    decoder.push('{"t":"x\u2028y\u2029z"}\n');
    expect(lines).toEqual(['{"t":"x\u2028y\u2029z"}']);
  });

  it("decodes a multi-byte UTF-8 character split across Buffer chunks", () => {
    const { decoder, lines } = collect();
    const bytes = Buffer.from('{"t":"é✓"}\n', "utf8");
    for (const b of bytes) decoder.push(Buffer.from([b]));
    expect(lines).toEqual(['{"t":"é✓"}']);
  });

  it("emits a final unterminated record on end", () => {
    const { decoder, lines } = collect();
    decoder.push('{"a":1}');
    expect(lines).toEqual([]);
    decoder.end();
    expect(lines).toEqual(['{"a":1}']);
  });

  it("skips empty lines", () => {
    const { decoder, lines } = collect();
    decoder.push('\n\r\n{"a":1}\n\n');
    expect(lines).toEqual(['{"a":1}']);
  });

  it("drops an oversized line, reports it once, and resyncs at the next LF", () => {
    const { decoder, lines, errors } = collect(10);
    decoder.push("x".repeat(8));
    decoder.push("y".repeat(8));
    decoder.push("z".repeat(8));
    decoder.push('\n{"ok":1}\n');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.length).toBeGreaterThan(10);
    expect(lines).toEqual(['{"ok":1}']);
  });

  it("drops an oversized line that arrives in one chunk", () => {
    const { decoder, lines, errors } = collect(10);
    decoder.push(`${"x".repeat(50)}\n{"ok":1}\n`);
    expect(errors).toHaveLength(1);
    expect(lines).toEqual(['{"ok":1}']);
  });

  it("drops an oversized unterminated tail on end", () => {
    const { decoder, lines, errors } = collect(10);
    decoder.push("x".repeat(50));
    decoder.end();
    expect(errors).toHaveLength(1);
    expect(lines).toEqual([]);
  });

  it("keeps working when the line handler throws", () => {
    const lines: string[] = [];
    const decoder = createJsonlDecoder({
      onLine: (line) => {
        lines.push(line);
        if (line === "boom") throw new Error("handler failed");
      },
    });
    expect(() => decoder.push("boom\nnext\n")).not.toThrow();
    expect(lines).toEqual(["boom", "next"]);
  });
});

describe("attachJsonlReader", () => {
  it("reads lines from a stream and detaches", () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    const detach = attachJsonlReader(stream, { onLine: (l) => lines.push(l) });
    stream.write('{"a":1}\n{"b"');
    stream.write(":2}\n");
    detach();
    stream.write('{"c":3}\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });
});

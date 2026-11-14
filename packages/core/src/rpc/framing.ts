import { StringDecoder } from "node:string_decoder";

/**
 * Strict JSONL framing for Blame's engine protocol, matching Pi 1.5.2's RPC mode
 * (`dist/modes/rpc/jsonl.js`): one JSON value per line, split on LF only, one trailing CR
 * stripped, UTF-8 decoded across chunk boundaries. Node's `readline` is not used because it also
 * splits on U+2028 and U+2029, which are legal inside JSON strings. Unlike Pi's reader, lines have
 * a length cap so a peer cannot grow our buffer without bound.
 */

/** Default cap for one record, in UTF-16 code units. Tool results can be large. */
export const DEFAULT_MAX_LINE_LENGTH = 16 * 1024 * 1024;

/** One record: `JSON.stringify` never emits a raw LF, so the trailing LF is the only one. */
export function serializeJsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export interface JsonlDecoderOptions {
  readonly onLine: (line: string) => void;
  /** Called once per dropped line with the length seen so far. The decoder resyncs at the next LF. */
  readonly onOversized?: (length: number) => void;
  readonly maxLineLength?: number;
}

export interface JsonlDecoder {
  push(chunk: Buffer | string): void;
  end(): void;
}

export function createJsonlDecoder(options: JsonlDecoderOptions): JsonlDecoder {
  const max = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  /** Set while skipping the rest of an oversized line. */
  let discarding = false;

  const emit = (raw: string) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.length === 0) return;
    try {
      options.onLine(line);
    } catch {
      // A failing handler must not break framing for the records after it.
    }
  };
  const oversized = (length: number) => {
    try {
      options.onOversized?.(length);
    } catch {
      // Same as above.
    }
  };

  const drain = () => {
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline === -1) break;
      const head = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (discarding) {
        discarding = false;
      } else if (head.length > max) {
        oversized(head.length);
      } else {
        emit(head);
      }
    }
    if (buffer.length > max) {
      if (!discarding) {
        discarding = true;
        oversized(buffer.length);
      }
      buffer = "";
    }
  };

  return {
    push(chunk) {
      buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
      drain();
    },
    end() {
      buffer += decoder.end();
      drain();
      if (!discarding && buffer.length > 0) emit(buffer);
      buffer = "";
      discarding = false;
    },
  };
}

/** Reads records from a stream. Returns a function that detaches the reader. */
export function attachJsonlReader(
  stream: NodeJS.ReadableStream,
  options: JsonlDecoderOptions,
): () => void {
  const decoder = createJsonlDecoder(options);
  const onData = (chunk: Buffer | string) => decoder.push(chunk);
  const onEnd = () => decoder.end();
  stream.on("data", onData);
  stream.on("end", onEnd);
  return () => {
    stream.off("data", onData);
    stream.off("end", onEnd);
  };
}

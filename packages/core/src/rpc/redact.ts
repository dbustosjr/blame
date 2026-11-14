export const REDACTED = "[redacted]";

/** Replaces every occurrence of each secret in every string inside `value` (a JSON-like tree). */
export function redactDeep<T>(value: T, secrets: readonly string[]): T {
  const live = secrets.filter((s) => s.length > 0);
  if (live.length === 0) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      let out = v;
      for (const s of live) out = out.split(s).join(REDACTED);
      return out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}

export interface StreamRedactor {
  /** Returns the text that is safe to emit now; holds back a tail that could start a secret. */
  push(text: string): string;
  /** Returns whatever is held back. Call at the end of a text stream. */
  flush(): string;
}

/** Redaction for streamed deltas, where a secret can arrive split across chunks. */
export function createStreamRedactor(secrets: readonly string[]): StreamRedactor {
  const live = secrets.filter((s) => s.length > 0);
  let pending = "";
  const redact = (t: string) => redactDeep(t, live);
  return {
    push(text) {
      if (live.length === 0) return text;
      pending = redact(pending + text);
      // Hold back the longest suffix that is a proper prefix of a secret.
      let hold = 0;
      for (const s of live) {
        for (let n = Math.min(s.length - 1, pending.length); n > hold; n--) {
          if (pending.endsWith(s.slice(0, n))) {
            hold = n;
            break;
          }
        }
      }
      const out = pending.slice(0, pending.length - hold);
      pending = pending.slice(pending.length - hold);
      return out;
    },
    flush() {
      const out = redact(pending);
      pending = "";
      return out;
    },
  };
}

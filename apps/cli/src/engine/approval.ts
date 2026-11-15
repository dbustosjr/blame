import { createInterface } from "node:readline";
import type { ApprovalPrompt } from "@blame-ai/core/engine-client";
import { stripAnsi, type Theme } from "../theme.js";

const BORDERS = {
  unicode: { tl: "\u256D", tr: "\u256E", bl: "\u2570", br: "\u256F", h: "\u2500", v: "\u2502" },
  ascii: { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" },
} as const;

/**
 * DESIGN.md permission prompt: a bordered box (status.warning, approval pending) naming the
 * exact files and the reason, with numbered choices. Deny is the default. "Allow for this
 * session" is not offered: protocol v1 has one approval per action.
 */
export function renderApprovalBox(req: ApprovalPrompt, theme: Theme, columns = 80): string {
  const b = theme.unicode ? BORDERS.unicode : BORDERS.ascii;
  const width = Math.max(40, Math.min(columns, 80));
  const inner = width - 4;
  const clip = (text: string) => (text.length > inner ? `${text.slice(0, inner - 3)}...` : text);
  const lines = [
    `Blame wants to run ${theme.token("text.primary", req.toolName, { bold: true })}`,
    ...req.paths.map((p) => `${theme.role("hint", "file:")} ${clip(p)}`),
    clip(req.reason),
    theme.role(
      "hint",
      clip(`capability: ${req.capability}${req.riskyClass ? `, risk: ${req.riskyClass}` : ""}`),
    ),
    "",
    "1. Allow once",
    `2. Deny ${theme.role("hint", "(default)")}`,
  ];
  const border = (s: string) => theme.token("status.warning", s);
  const out = [border(`${b.tl}${b.h.repeat(width - 2)}${b.tr}`)];
  for (const line of lines) {
    const pad = Math.max(0, inner - stripAnsi(line).length);
    out.push(`${border(b.v)} ${line}${" ".repeat(pad)} ${border(b.v)}`);
  }
  out.push(border(`${b.bl}${b.h.repeat(width - 2)}${b.br}`));
  return `${out.join("\n")}\n`;
}

const YES = new Set(["1", "y", "yes"]);

export interface TerminalApproverOptions {
  readonly input: NodeJS.ReadableStream & { isTTY?: boolean };
  readonly output: NodeJS.WritableStream & { columns?: number };
  readonly theme: Theme;
}

/**
 * Asks in the terminal. Only an explicit "1", "y" or "yes" approves. No TTY, Ctrl-C, EOF, a
 * timeout or cancel (the signal), Enter alone, or any other answer denies.
 */
export function createTerminalApprover(
  options: TerminalApproverOptions,
): (req: ApprovalPrompt, signal: AbortSignal) => Promise<boolean> {
  const { input, output, theme } = options;
  return (req, signal) =>
    new Promise<boolean>((resolve) => {
      if (signal.aborted) {
        resolve(false);
        return;
      }
      if (input.isTTY !== true) {
        output.write(
          `${theme.token("status.error", "Denied:")} no terminal to ask in, so ${req.toolName} was not run.\n`,
        );
        resolve(false);
        return;
      }
      output.write(renderApprovalBox(req, theme, output.columns ?? 80));
      const rl = createInterface({ input, output, terminal: true });
      let settled = false;
      const finish = (approved: boolean, note?: string) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        if (note) output.write(`\n${theme.token("status.error", "Denied:")} ${note}\n`);
        rl.close();
        resolve(approved);
      };
      const onAbort = () => finish(false, "the approval timed out or was cancelled.");
      signal.addEventListener("abort", onAbort, { once: true });
      rl.on("SIGINT", () => finish(false, "cancelled with Ctrl-C."));
      rl.on("close", () => finish(false));
      rl.question("Choose 1 or 2 [2]: ", (answer) => {
        const approved = YES.has(answer.trim().toLowerCase()) && !signal.aborted;
        finish(approved, approved ? undefined : `${req.toolName} was not run.`);
      });
    });
}

/** Masked line input for the key prompt. Resolves undefined on no TTY, Ctrl-C or EOF. */
export function askHidden(
  input: NodeJS.ReadableStream & { isTTY?: boolean },
  output: NodeJS.WritableStream,
  question: string,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (input.isTTY !== true) {
      resolve(undefined);
      return;
    }
    output.write(question);
    // readline echoes typed characters to its output; give it one that drops everything.
    const muted = {
      write: () => true,
      on: () => muted,
      once: () => muted,
      emit: () => false,
      end: () => muted,
      removeListener: () => muted,
    } as unknown as NodeJS.WritableStream;
    const rl = createInterface({ input, output: muted, terminal: true });
    let done = false;
    const finish = (value: string | undefined) => {
      if (done) return;
      done = true;
      output.write("\n");
      rl.close();
      resolve(value);
    };
    rl.on("SIGINT", () => finish(undefined));
    rl.on("close", () => finish(undefined));
    rl.on("line", (line) => finish(line));
  });
}

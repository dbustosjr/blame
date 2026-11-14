import { parseArgs } from "node:util";
import { defaultPolicy } from "@blame-ai/core";

/** Valid `--mode` values come from the preset seed data, not a hard-coded list (FR-AUTO-3). */
export const modes: readonly string[] = defaultPolicy.presets.map((p) => p.id);

export type ParsedArgs =
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | { readonly kind: "run"; readonly mode: string }
  | { readonly kind: "error"; readonly message: string };

export function parseCliArgs(argv: readonly string[]): ParsedArgs {
  let values: { help?: boolean; version?: boolean; mode?: string };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        mode: { type: "string", short: "m" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
  if (values.help) return { kind: "help" };
  if (values.version) return { kind: "version" };
  const fallback = defaultPolicy.presets.find((p) => p.isDefault)?.id ?? "guided";
  const mode = (values.mode ?? fallback).toLowerCase();
  if (!modes.includes(mode)) {
    return {
      kind: "error",
      message: `Unknown mode "${values.mode}". Use one of: ${modes.join(", ")}.`,
    };
  }
  return { kind: "run", mode };
}

export function helpText(): string {
  return [
    "Usage: blame [options]",
    "",
    "Blame is a coding agent that owns its mistakes.",
    "",
    "Options:",
    `  -m, --mode <mode>  Autonomy preset: ${modes.join(", ")} (default: guided)`,
    "  -v, --version      Print the version",
    "  -h, --help         Show this help",
    "",
    "Autonomous needs an explicit opt-in per workspace and the sandbox.",
    "Set NO_COLOR=1 for plain output.",
    "",
  ].join("\n");
}

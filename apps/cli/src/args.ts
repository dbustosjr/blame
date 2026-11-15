import { parseArgs } from "node:util";
import { defaultPolicy } from "@blame-ai/core";

/** Valid `--mode` values come from the preset seed data, not a hard-coded list (FR-AUTO-3). */
export const modes: readonly string[] = defaultPolicy.presets.map((p) => p.id);

export const DEFAULT_PROVIDER = "anthropic";

export type ParsedArgs =
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | {
      readonly kind: "run";
      readonly mode: string;
      readonly provider: string;
      readonly model?: string;
      readonly verbose: boolean;
      /** The task, from the positional words. None means the welcome screen. */
      readonly task?: string;
    }
  | { readonly kind: "error"; readonly message: string };

export function parseCliArgs(argv: readonly string[]): ParsedArgs {
  let values: {
    help?: boolean;
    version?: boolean;
    mode?: string;
    provider?: string;
    model?: string;
    verbose?: boolean;
  };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        mode: { type: "string", short: "m" },
        provider: { type: "string" },
        model: { type: "string" },
        verbose: { type: "boolean" },
      },
      strict: true,
      allowPositionals: true,
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
  const task = positionals.join(" ").trim();
  return {
    kind: "run",
    mode,
    provider: values.provider?.trim() || DEFAULT_PROVIDER,
    ...(values.model?.trim() ? { model: values.model.trim() } : {}),
    verbose: values.verbose === true,
    ...(task === "" ? {} : { task }),
  };
}

export function helpText(): string {
  return [
    "Usage: blame [options] [task...]",
    "",
    "Blame is a coding agent that owns its mistakes.",
    "With a task, Blame runs it once in this folder and exits.",
    "",
    "Options:",
    `  -m, --mode <mode>  Autonomy preset: ${modes.join(", ")} (default: guided)`,
    `      --provider <id> Model provider (default: ${DEFAULT_PROVIDER})`,
    "      --model <id>   Model id at that provider (needed to run a task)",
    "      --verbose      Show the engine's log on stderr (redacted)",
    "  -v, --version      Print the version",
    "  -h, --help         Show this help",
    "",
    "Model key: BLAME_API_KEY, read once at start, or a hidden prompt in a terminal.",
    "Guided asks before every shell command. Autonomous does not run tools until",
    "the sandbox ships: the policy blocks every Autonomous tool call for now.",
    "Engine log: ~/.blame/logs/engine.log (BLAME_CONFIG_DIR moves ~/.blame).",
    "Set NO_COLOR=1 for plain output.",
    "",
  ].join("\n");
}

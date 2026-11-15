import { homedir } from "node:os";
import { join } from "node:path";
import { helpText, parseCliArgs } from "./args.js";
import { askHidden, createTerminalApprover } from "./engine/approval.js";
import { resolveEngineEntry } from "./engine/entry.js";
import {
  envKeySource,
  firstKeySource,
  type KeySource,
  promptKeySource,
} from "./engine/keySource.js";
import { type RunTaskOptions, runTask, type SignalSource } from "./engine/run.js";
import { themeForProcess } from "./theme.js";
import { readVersion } from "./version.js";
import { renderWelcome } from "./welcome.js";

export interface Io {
  readonly stdout: { write(s: string): unknown; isTTY?: boolean; columns?: number };
  readonly stderr: { write(s: string): unknown };
  readonly cwd: string;
  /** Terminal input for approvals and the key prompt. Default: process.stdin. */
  readonly stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
  /** Key from the environment, read once at startup (bin.ts). Default: envKeySource(). */
  readonly envKey?: KeySource;
  readonly signals?: SignalSource;
  /** For tests. Default: runTask. */
  readonly runTask?: (options: RunTaskOptions) => Promise<number>;
}

/**
 * Key sources in order. The OS keychain KeyStore (feat/cli-keychain-backend) slots in here as the
 * first source once it lands; env and the hidden prompt stay as fallbacks.
 */
export function defaultKeySources(io: Io): KeySource {
  const stdin = io.stdin ?? process.stdin;
  const prompt = promptKeySource((question) => askHidden(stdin, process.stderr, question));
  return firstKeySource([io.envKey ?? envKeySource(), prompt]);
}

/** Runs the CLI and returns the exit code. */
export async function main(argv: readonly string[], io: Io): Promise<number> {
  const parsed = parseCliArgs(argv);
  switch (parsed.kind) {
    case "help":
      io.stdout.write(helpText());
      return 0;
    case "version":
      io.stdout.write(`${readVersion()}\n`);
      return 0;
    case "error":
      io.stderr.write(`blame: ${parsed.message}\nRun "blame --help" for usage.\n`);
      return 2;
    case "run": {
      const theme = themeForProcess(io.stdout);
      if (parsed.task === undefined) {
        io.stdout.write(
          renderWelcome({
            theme,
            cwd: io.cwd,
            mode: parsed.mode,
            version: readVersion(),
            ...(io.stdout.columns ? { columns: io.stdout.columns } : {}),
          }),
        );
        io.stdout.write(
          'The interactive session is not built yet. Run a task with: blame --model <id> "task"\n',
        );
        return 0;
      }
      if (parsed.model === undefined) {
        io.stderr.write('blame: pass --model <id> to run a task.\nRun "blame --help" for usage.\n');
        return 2;
      }
      const configDir = process.env.BLAME_CONFIG_DIR?.trim() || join(homedir(), ".blame");
      const stdin = io.stdin ?? process.stdin;
      const run = io.runTask ?? runTask;
      return run({
        task: parsed.task,
        cwd: io.cwd,
        presetId: parsed.mode,
        providerId: parsed.provider,
        modelId: parsed.model,
        configDir,
        entry: resolveEngineEntry(),
        keySource: defaultKeySources(io),
        approve: createTerminalApprover({
          input: stdin,
          output: process.stderr,
          theme,
          // A second Ctrl-C at an approval stops the task through the same SIGINT path.
          onInterruptAgain: () => {
            process.emit("SIGINT", "SIGINT");
          },
        }),
        stdout: io.stdout,
        stderr: io.stderr,
        theme,
        verbose: parsed.verbose,
        logFile: join(configDir, "logs", "engine.log"),
        ...(io.signals ? { signals: io.signals } : {}),
      });
    }
  }
}

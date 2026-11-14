import { helpText, parseCliArgs } from "./args.js";
import { themeForProcess } from "./theme.js";
import { readVersion } from "./version.js";
import { renderWelcome } from "./welcome.js";

export interface Io {
  readonly stdout: { write(s: string): unknown; isTTY?: boolean; columns?: number };
  readonly stderr: { write(s: string): unknown };
  readonly cwd: string;
}

/** Runs the CLI and returns the exit code. */
export function main(argv: readonly string[], io: Io): number {
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
      io.stdout.write(
        renderWelcome({
          theme,
          cwd: io.cwd,
          mode: parsed.mode,
          version: readVersion(),
          ...(io.stdout.columns ? { columns: io.stdout.columns } : {}),
        }),
      );
      io.stdout.write("The interactive session is not built yet (Phase 3).\n");
      return 0;
    }
  }
}

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { terminalThemeContents } from "./terminal-theme.js";

/** Package root, whether this file is loaded from src/ or dist/. */
function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

export function defaultThemesDirectory(): string {
  return join(packageRoot(), "themes");
}

/** Write the three theme files into `outDir` (defaults to packages/design-tokens/themes). */
export function writeTerminalThemes(outDir = defaultThemesDirectory()): void {
  mkdirSync(outDir, { recursive: true });
  for (const [filename, contents] of Object.entries(terminalThemeContents())) {
    writeFileSync(join(outDir, filename), contents);
  }
}

const entry = process.argv[1];
if (entry && pathToFileURL(entry).href === import.meta.url) {
  writeTerminalThemes();
}

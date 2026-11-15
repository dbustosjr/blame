import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Builds once before any test file runs: core's dist (the faux engine fixture imports it) and
// this extension's bundles with metafiles (dist/extension.js, dist/engine.mjs).
export default function setup(): void {
  const appDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const coreDir = join(appDir, "..", "..", "packages", "core");
  const tsc = createRequire(join(coreDir, "package.json")).resolve("typescript/bin/tsc");
  execFileSync(process.execPath, [tsc, "-p", join(coreDir, "tsconfig.build.json")], {
    cwd: coreDir,
    stdio: "inherit",
  });
  execFileSync(process.execPath, [join(appDir, "esbuild.mjs"), "--metafile"], {
    cwd: appDir,
    stdio: "inherit",
  });
}

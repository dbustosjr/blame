import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Builds core's dist once: the engine entry (dist/rpc/main.js) and the faux engine fixture use it.
export default function setup(): void {
  const coreDir = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    "packages",
    "core",
  );
  const tsc = createRequire(join(coreDir, "package.json")).resolve("typescript/bin/tsc");
  execFileSync(process.execPath, [tsc, "-p", join(coreDir, "tsconfig.build.json")], {
    cwd: coreDir,
    stdio: "inherit",
  });
}

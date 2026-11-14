// Runs Impeccable's design check after the agent writes a file.
// Cross-platform: Cursor runs hook commands through PowerShell on Windows
// and a POSIX shell elsewhere, so the logic lives here instead of in hooks.json.
// Does nothing if Impeccable isn't installed locally (it is gitignored).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const isWindows = process.platform === "win32";
const script = join(
  ".cursor",
  "skills",
  "impeccable",
  "scripts",
  isWindows ? "impeccable.cmd" : "impeccable",
);

if (!existsSync(script)) process.exit(0);

const result = spawnSync(script, ["hook"], { stdio: "inherit", shell: isWindows });
process.exit(result.status ?? 0);

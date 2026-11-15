import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/test/**/*.test.js",
  version: "stable",
  workspaceFolder: ".",
  mocha: { ui: "tdd", timeout: 20000 },
  // Workspace trust off: the engine refuses to start in Restricted Mode.
  launchArgs: ["--disable-extensions", "--disable-workspace-trust"],
});

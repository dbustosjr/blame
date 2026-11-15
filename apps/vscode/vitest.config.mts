import { defineConfig } from "vitest/config";

const conditions = ["@blame-ai/source", "node", "import", "module", "default"];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  // src/test holds the @vscode/test-electron suite, which runs inside VS Code, not Vitest.
  test: {
    include: ["test/**/*.test.ts"],
    // Builds core's dist and the extension bundles once; real-engine tests spawn them.
    globalSetup: ["test/setup/build.ts"],
    testTimeout: 60_000,
  },
});

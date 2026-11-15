import { defineConfig } from "vitest/config";

const conditions = ["@blame-ai/source", "node", "import", "module", "default"];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  test: {
    include: ["test/**/*.test.ts"],
    // Builds core's dist once; the engine tests spawn its entry and core's faux engine fixture.
    globalSetup: ["test/setup/build.ts"],
    testTimeout: 60_000,
  },
});

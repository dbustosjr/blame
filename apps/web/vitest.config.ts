import { defineConfig } from "vitest/config";

const conditions = ["@blame-ai/source", "node", "import", "module", "default"];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  test: { include: ["test/**/*.test.ts"] },
});

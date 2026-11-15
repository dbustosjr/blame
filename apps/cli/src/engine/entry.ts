import { createRequire } from "node:module";

/**
 * Absolute path of core's built engine entry (dist/rpc/main.js), resolved through the
 * `@blame-ai/core/engine` export. Passed to the client explicitly, never left to its default.
 */
export function resolveEngineEntry(): string {
  return createRequire(import.meta.url).resolve("@blame-ai/core/engine");
}

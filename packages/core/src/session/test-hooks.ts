import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

/**
 * TEST ONLY. Not part of BlameSessionOptions and not exported from the package index, so hosts
 * and config files cannot reach it: a symbol key cannot come from JSON or settings. Tests import
 * this module directly to add extension factories after Blame's own, for example one that throws
 * to prove createBlameSession refuses to start on an extension load error (#40, THREAT_MODEL T-19).
 */
export const TEST_ONLY_EXTRA_EXTENSION_FACTORIES: unique symbol = Symbol(
  "blame.testOnlyExtraExtensionFactories",
);

export function testOnlyExtraExtensionFactories(options: object): readonly ExtensionFactory[] {
  const value = (options as Record<symbol, unknown>)[TEST_ONLY_EXTRA_EXTENSION_FACTORIES];
  return Array.isArray(value) ? (value as ExtensionFactory[]) : [];
}

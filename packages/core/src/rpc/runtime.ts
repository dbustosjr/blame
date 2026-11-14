/** Pi 1.5.2 and Blame need Node 22.19 or newer (`engines`). */
export const MIN_ENGINE_NODE_VERSION = "22.19.0";

export interface EngineRuntimeInput {
  /** An explicit executable wins over everything else (user setting, tests). */
  readonly command?: string;
  readonly execPath?: string;
  readonly versions: { readonly node: string; readonly electron?: string };
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Used when the host's Node is too old, for example "node" from PATH. */
  readonly fallbackNode?: string;
}

export type EngineRuntime =
  | {
      readonly ok: true;
      readonly command: string;
      readonly env: Record<string, string | undefined>;
      /** The command's Node version is unknown: check `--version` before you trust it. */
      readonly needsVersionCheck?: true;
    }
  | { readonly ok: false; readonly reason: string };

function parse(version: string): [number, number, number] {
  const [a, b, c] = version
    .replace(/^v/, "")
    .split(".")
    .map((n) => Number.parseInt(n, 10));
  return [a ?? 0, b ?? 0, c ?? 0];
}

/** True when `version` (for example "22.19.0" or "v24.1.0") is at least MIN_ENGINE_NODE_VERSION. */
export function isSupportedNodeVersion(version: string): boolean {
  const have = parse(version);
  const need = parse(MIN_ENGINE_NODE_VERSION);
  for (let i = 0; i < 3; i++) {
    if ((have[i] ?? 0) !== (need[i] ?? 0)) return (have[i] ?? 0) > (need[i] ?? 0);
  }
  return true;
}

/**
 * Picks the executable for the engine child (ARCHITECTURE 4, blame-vscode-extension skill): the
 * host's own `process.execPath` when its Node is new enough, with `ELECTRON_RUN_AS_NODE=1` inside
 * an editor (VS Code, Cursor, Windsurf run on Electron); else a Node from PATH; else an error the
 * host can show as an install prompt.
 */
export function resolveEngineRuntime(input: EngineRuntimeInput): EngineRuntime {
  const { ELECTRON_RUN_AS_NODE: _drop, ...baseEnv } = input.env;
  if (input.command !== undefined) return { ok: true, command: input.command, env: { ...baseEnv } };
  if (input.execPath !== undefined && isSupportedNodeVersion(input.versions.node)) {
    const env: Record<string, string | undefined> = { ...baseEnv };
    if (input.versions.electron !== undefined) env.ELECTRON_RUN_AS_NODE = "1";
    return { ok: true, command: input.execPath, env };
  }
  if (input.fallbackNode !== undefined) {
    return { ok: true, command: input.fallbackNode, env: { ...baseEnv }, needsVersionCheck: true };
  }
  return {
    ok: false,
    reason: `Blame needs Node ${MIN_ENGINE_NODE_VERSION} or newer; this host has ${input.versions.node}. Install Node ${MIN_ENGINE_NODE_VERSION}+ and put it on PATH.`,
  };
}

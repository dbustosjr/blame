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

const POSIX_ENV = ["PATH", "HOME", "LANG", "LANGUAGE", "TMPDIR", "TMP", "TEMP"];
const WINDOWS_ENV = [
  "PATH",
  "USERPROFILE",
  "HOME",
  "TMP",
  "TEMP",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "LANG",
];

/**
 * The engine child's environment (issue #38): a short allowlist of the host's variables, never the
 * whole `process.env`, so provider keys and tokens in the editor's environment (OPENAI_API_KEY,
 * GITHUB_TOKEN, ...) do not reach Pi, which falls back to such variables when it has no key.
 * Keeps PATH, home, locale (LANG, LANGUAGE, LC_*) and temp dirs; on Windows also SystemRoot,
 * WINDIR and COMSPEC, matched case-insensitively with the host's spelling kept (Path, windir).
 * `extraEnv` is added as is; the engine still scrubs credential-looking names (scrubEngineEnv), so
 * keys go in `init.apiKey`, not here. ELECTRON_RUN_AS_NODE is added by resolveEngineRuntime.
 */
export function buildEngineEnv(
  hostEnv: Readonly<Record<string, string | undefined>>,
  options: {
    readonly platform?: NodeJS.Platform;
    readonly extraEnv?: Readonly<Record<string, string>>;
  } = {},
): Record<string, string> {
  const windows = (options.platform ?? process.platform) === "win32";
  const allowed = new Set(windows ? WINDOWS_ENV : POSIX_ENV);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(hostEnv)) {
    if (value === undefined) continue;
    const key = windows ? name.toUpperCase() : name;
    if (allowed.has(key) || key.startsWith("LC_")) env[name] = value;
  }
  return { ...env, ...(options.extraEnv ?? {}) };
}

const CREDENTIAL_ENV =
  /(API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|PRIVATE_KEY|ACCESS_KEY)|^(AWS|AZURE|GOOGLE|GCLOUD|ANTHROPIC|OPENAI)_/i;

/**
 * Engine side of issue #38: Pi 1.5.2 resolves provider auth from `process.env` when no key is
 * stored (`defaultProviderAuthContext` in pi-ai `auth/context.js`, for example ANTHROPIC_API_KEY,
 * OPENAI_API_KEY). The engine takes keys only from `init.apiKey`, so it deletes credential-looking
 * variables from `env` (in place) before Pi starts. Returns the removed names.
 */
export function scrubEngineEnv(env: Record<string, string | undefined>): string[] {
  const removed: string[] = [];
  for (const name of Object.keys(env)) {
    if (CREDENTIAL_ENV.test(name)) {
      delete env[name];
      removed.push(name);
    }
  }
  return removed;
}

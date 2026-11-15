/**
 * Where the CLI gets the BYOK key. The OS keychain store (feat/cli-keychain-backend) plugs in
 * here as one more KeySource, placed first in the list built by `defaultKeySources` in main.ts.
 */
export interface KeySource {
  /** Shown in messages, never the key itself. */
  readonly name: string;
  get(providerId: string): Promise<string | undefined>;
}

export const API_KEY_ENV = "BLAME_API_KEY";

/**
 * Reads BLAME_API_KEY once, then deletes it from `env` so nothing later (the engine's env, a
 * log, a crash dump) can see it. The engine env is an allowlist anyway, and scrubEngineEnv runs
 * in the child too.
 */
export function envKeySource(env: NodeJS.ProcessEnv = process.env): KeySource {
  const raw = env[API_KEY_ENV];
  delete env[API_KEY_ENV];
  const value = raw?.trim();
  return {
    name: API_KEY_ENV,
    get: async () => (value === undefined || value === "" ? undefined : value),
  };
}

/** Asks for the key with a masked prompt. `ask` returns undefined on no TTY, Ctrl-C or EOF. */
export function promptKeySource(ask: (question: string) => Promise<string | undefined>): KeySource {
  return {
    name: "prompt",
    get: async (providerId) => {
      const value = (await ask(`Model key for ${providerId} (input hidden): `))?.trim();
      return value === undefined || value === "" ? undefined : value;
    },
  };
}

/** The first source that has a key wins. */
export function firstKeySource(sources: readonly KeySource[]): KeySource {
  return {
    name: sources.map((s) => s.name).join(", "),
    get: async (providerId) => {
      for (const source of sources) {
        const value = await source.get(providerId);
        if (value !== undefined) return value;
      }
      return undefined;
    },
  };
}

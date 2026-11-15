import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";

/**
 * Where Blame keeps provider API keys (R-BYOK-4, TRD FR-KEY-1). Keyed by Pi provider id.
 *
 * Backends: the extension passes keys from VS Code SecretStorage over the RPC pipe and holds them
 * in an InMemoryKeyStore in the core child. The CLI backend is the OS keychain through
 * `@napi-rs/keyring` (macOS Keychain, Windows Credential Manager, Linux Secret Service):
 * `KeychainKeyStore` in `apps/cli/src/keys/keychain.ts`. It lives in the CLI package so core and
 * the extension bundle never depend on the native binary. No backend ever writes a plaintext file.
 */
export interface KeyStore {
  get(providerId: string): Promise<string | undefined>;
  set(providerId: string, key: string): Promise<void>;
  delete(providerId: string): Promise<void>;
  list(): Promise<string[]>;
}

/** Process-memory key store, for the extension's core child and for tests. */
export class InMemoryKeyStore implements KeyStore {
  readonly #keys = new Map<string, string>();

  async get(providerId: string): Promise<string | undefined> {
    return this.#keys.get(providerId);
  }

  async set(providerId: string, key: string): Promise<void> {
    this.#keys.set(providerId, key);
  }

  async delete(providerId: string): Promise<void> {
    this.#keys.delete(providerId);
  }

  async list(): Promise<string[]> {
    return [...this.#keys.keys()];
  }
}

/**
 * Pi `CredentialStore` (pi-ai `auth/types.ts`) over a Blame KeyStore, so keys reach Pi without
 * Pi's file-backed `auth.json` (TRD FR-KEY-2). API keys only for now: OAuth credentials (ChatGPT
 * sign-in) are refused until that path is approved and specced (Week 0 decision, FR-KEY-3).
 * Writes are serialized per provider, as the interface requires.
 */
export function keyStoreCredentials(keys: KeyStore): CredentialStore {
  const chains = new Map<string, Promise<unknown>>();
  const serialize = <T>(providerId: string, task: () => Promise<T>): Promise<T> => {
    const previous = chains.get(providerId) ?? Promise.resolve();
    const next = previous.then(task, task);
    chains.set(
      providerId,
      next.catch(() => undefined),
    );
    return next;
  };
  const read = async (providerId: string): Promise<Credential | undefined> => {
    const key = await keys.get(providerId);
    return key === undefined ? undefined : { type: "api_key", key };
  };

  return {
    read,
    async list(): Promise<readonly CredentialInfo[]> {
      return (await keys.list()).map((providerId) => ({ providerId, type: "api_key" }));
    },
    modify(providerId, fn) {
      return serialize(providerId, async () => {
        const current = await read(providerId);
        const next = await fn(current);
        if (next === undefined) return current;
        if (next.type !== "api_key") {
          throw new Error(
            "Blame does not store OAuth credentials yet (ChatGPT sign-in is pending)",
          );
        }
        if (next.key === undefined) {
          await keys.delete(providerId);
          return undefined;
        }
        await keys.set(providerId, next.key);
        return { type: "api_key", key: next.key };
      });
    },
    delete(providerId) {
      return serialize(providerId, () => keys.delete(providerId));
    },
  };
}

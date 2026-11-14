import type { SecretStorage } from "vscode";

/**
 * BYOK key store on VS Code SecretStorage (`context.secrets`). Keys never go to settings JSON,
 * plaintext files or Pi's auth.json (R-BYOK-4, TRD FR-KEY-1). Phase 0 stub: the provider list and
 * the RPC bridge to core arrive in Phases 1 and 4.
 */

const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PREFIX = "blame.apiKey.";

/** The subset of SecretStorage this module uses, so tests can pass a fake. */
export type SecretStore = Pick<SecretStorage, "get" | "store" | "delete">;

export class KeyStore {
  constructor(private readonly secrets: SecretStore) {}

  static secretName(provider: string): string {
    if (!PROVIDER_ID.test(provider)) {
      throw new Error(`Invalid provider id "${provider}"`);
    }
    return `${PREFIX}${provider}`;
  }

  async get(provider: string): Promise<string | undefined> {
    return this.secrets.get(KeyStore.secretName(provider));
  }

  async set(provider: string, key: string): Promise<void> {
    const trimmed = key.trim();
    if (trimmed.length === 0) throw new Error("Key is empty");
    await this.secrets.store(KeyStore.secretName(provider), trimmed);
  }

  async has(provider: string): Promise<boolean> {
    return (await this.get(provider)) !== undefined;
  }

  async delete(provider: string): Promise<void> {
    await this.secrets.delete(KeyStore.secretName(provider));
  }
}

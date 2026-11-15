import type {
  Credential,
  CredentialInfo,
  CredentialStore,
  OAuthCredentials,
} from "@earendil-works/pi-ai";
import { BlameAuthPolicyError, isAuthMethodAllowed } from "../auth/policy.js";

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

/** An OAuth token set as Pi stores it: `access`, `refresh`, `expires` and provider extras. */
export type OAuthTokens = OAuthCredentials;

/**
 * Optional KeyStore capability: OAuth token sets (ChatGPT sign-in, FR-KEY-3). Only providers on the
 * auth policy's OAuth allowlist (`openai`, `openai-codex`) may be stored. Values are secrets: never
 * log them, put them in errors or audit events, or send them over the engine protocol.
 */
export interface OAuthTokenStore {
  getOAuth(providerId: string): Promise<OAuthCredentials | undefined>;
  setOAuth(providerId: string, tokens: OAuthCredentials): Promise<void>;
  deleteOAuth(providerId: string): Promise<void>;
  /** Provider ids with stored tokens. Never token values. */
  listOAuth(): Promise<string[]>;
}

export function supportsOAuth(keys: KeyStore): keys is KeyStore & OAuthTokenStore {
  const k = keys as Partial<OAuthTokenStore>;
  return (
    typeof k.getOAuth === "function" &&
    typeof k.setOAuth === "function" &&
    typeof k.deleteOAuth === "function" &&
    typeof k.listOAuth === "function"
  );
}

/** Throws unless `providerId` may hold OAuth tokens under Blame's auth policy. */
export function assertOAuthAllowed(providerId: string): void {
  if (!isAuthMethodAllowed(providerId, "oauth"))
    throw new BlameAuthPolicyError(providerId, "oauth");
}

/** Process-memory key store, for the extension's core child and for tests. */
export class InMemoryKeyStore implements KeyStore, OAuthTokenStore {
  readonly #keys = new Map<string, string>();
  readonly #oauth = new Map<string, OAuthCredentials>();

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

  async getOAuth(providerId: string): Promise<OAuthCredentials | undefined> {
    const tokens = this.#oauth.get(providerId);
    return tokens === undefined ? undefined : { ...tokens };
  }

  /**
   * Does not check the allowlist, so tests can plant a disallowed token the way another tool
   * might. `keyStoreCredentials` and the CLI keychain store enforce the policy.
   */
  async setOAuth(providerId: string, tokens: OAuthCredentials): Promise<void> {
    this.#oauth.set(providerId, { ...tokens });
  }

  async deleteOAuth(providerId: string): Promise<void> {
    this.#oauth.delete(providerId);
  }

  async listOAuth(): Promise<string[]> {
    return [...this.#oauth.keys()].sort();
  }
}

function oauthTokens(credential: Credential & { type: "oauth" }): OAuthCredentials {
  const { type: _type, ...tokens } = credential;
  return tokens;
}

/**
 * Pi `CredentialStore` (pi-ai `auth/types.ts`) over a Blame KeyStore, so keys and ChatGPT sign-in
 * tokens reach Pi without Pi's file-backed `auth.json` (TRD FR-KEY-2, FR-KEY-3).
 *
 * - API keys work for every provider.
 * - OAuth tokens are stored only when the KeyStore supports them and only for providers on the auth
 *   policy's allowlist. Anything else is refused with BlameAuthPolicyError, and a disallowed token
 *   already in the backing store is never served. Wrap the result in `policyCredentialStore` too.
 * - One credential per provider, as Pi expects: saving a sign-in clears that provider's API key and
 *   the reverse. When both exist anyway, the sign-in wins.
 * - Writes, including Pi's token refresh inside `modify`, are serialized per provider in process.
 *   Two Blame processes can still race on a refresh; the loser's next refresh re-signs in.
 */
export function keyStoreCredentials(keys: KeyStore): CredentialStore {
  const oauth = supportsOAuth(keys) ? keys : undefined;
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
  const readOAuth = async (providerId: string) =>
    oauth && isAuthMethodAllowed(providerId, "oauth") ? oauth.getOAuth(providerId) : undefined;
  const read = async (providerId: string): Promise<Credential | undefined> => {
    const tokens = await readOAuth(providerId);
    if (tokens !== undefined) return { ...tokens, type: "oauth" };
    const key = await keys.get(providerId);
    return key === undefined ? undefined : { type: "api_key", key };
  };
  const deleteAll = async (providerId: string) => {
    await keys.delete(providerId);
    if (oauth && (await oauth.listOAuth()).includes(providerId))
      await oauth.deleteOAuth(providerId);
  };

  return {
    read,
    async list(): Promise<readonly CredentialInfo[]> {
      const signedIn = oauth
        ? (await oauth.listOAuth()).filter((id) => isAuthMethodAllowed(id, "oauth"))
        : [];
      const withKeys = (await keys.list()).filter((id) => !signedIn.includes(id));
      return [
        ...signedIn.map((providerId) => ({ providerId, type: "oauth" as const })),
        ...withKeys.map((providerId) => ({ providerId, type: "api_key" as const })),
      ].sort((a, b) => a.providerId.localeCompare(b.providerId));
    },
    modify(providerId, fn) {
      return serialize(providerId, async () => {
        const current = await read(providerId);
        const next = await fn(current);
        if (next === undefined) return current;
        if (next.type === "oauth") {
          assertOAuthAllowed(providerId);
          if (!oauth) {
            throw new Error(
              "This key store does not support OAuth sign-in tokens; use an API key for this provider",
            );
          }
          const tokens = oauthTokens(next);
          await oauth.setOAuth(providerId, tokens);
          await keys.delete(providerId);
          return { ...tokens, type: "oauth" };
        }
        if (next.key === undefined) {
          await deleteAll(providerId);
          return undefined;
        }
        await keys.set(providerId, next.key);
        if (oauth && (await oauth.listOAuth()).includes(providerId)) {
          await oauth.deleteOAuth(providerId);
        }
        return { type: "api_key", key: next.key };
      });
    },
    delete(providerId) {
      return serialize(providerId, () => deleteAll(providerId));
    },
  };
}

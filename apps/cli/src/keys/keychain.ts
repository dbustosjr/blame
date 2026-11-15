import { randomBytes } from "node:crypto";
import {
  assertOAuthAllowed,
  InMemoryKeyStore,
  type KeyStore,
  type OAuthTokenStore,
  type OAuthTokens,
} from "@blame-ai/core";

/**
 * The CLI's BYOK key store on the OS keychain through `@napi-rs/keyring` (macOS Keychain, Windows
 * Credential Manager, Linux Secret Service). R-BYOK-4, TRD FR-KEY-1, THREAT_MODEL T-02.
 *
 * It lives in the CLI package, not in `packages/core`, so the core package and the VS Code
 * extension bundle (which uses SecretStorage) never depend on the native binary. The module is also
 * loaded with a dynamic `import()` on first use, so `blame --help` and every test that does not
 * touch keys never load it.
 *
 * It never falls back to a plaintext file or an environment variable. When the keychain is missing
 * or locked it throws a KeychainError that says what to do. Errors never carry the key, the native
 * error text or a `cause`, because a native message could echo what it was given.
 */

/** The `@napi-rs/keyring` surface Blame uses. Tests pass a fake. */
export interface KeyringEntry {
  getPassword(): Promise<string | null>;
  setPassword(password: string): Promise<void>;
  deletePassword(): Promise<boolean>;
}

export interface KeyringModule {
  AsyncEntry: new (
    service: string,
    account: string,
    options?: { linux?: { store?: "secret-service" | "keyutils" } },
  ) => KeyringEntry;
}

/** Keychain service name for every Blame entry. Matches the extension's `blame.` prefix. */
export const KEYCHAIN_SERVICE = "blame";

/** Account that holds the JSON list of provider ids with a stored key. Never holds a secret. */
export const KEYCHAIN_INDEX_ACCOUNT = "index.apiKey";

const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Account that holds the JSON list of provider ids with stored OAuth tokens. Never a secret. */
export const KEYCHAIN_OAUTH_INDEX_ACCOUNT = "index.oauth";

/**
 * OAuth token sets are split into entries of at most this many UTF-16 code units, so each one fits
 * Windows Credential Manager (2000 bytes as UTF-16). ChatGPT access tokens are JWTs that can pass
 * the 2560-byte limit on their own. The serialized JSON is pure ASCII, so no chunk splits a
 * character.
 */
export const OAUTH_CHUNK_CHARS = 1000;
const OAUTH_MAX_CHUNKS = 32;
const OAUTH_GENERATION = /^[0-9a-f]{16}$/;

/** Windows Credential Manager blob limit (CRED_MAX_CREDENTIAL_BLOB_SIZE). keyring stores UTF-16. */
export const WINDOWS_MAX_SECRET_BYTES = 2560;

export type KeychainErrorCode =
  | "keychain_unavailable"
  | "keychain_locked"
  | "too_long"
  | "invalid"
  | "corrupt"
  | "keychain_error";

export type KeychainOperation = "get" | "set" | "delete" | "list" | "load";

/**
 * A keychain failure with fixed, secret-free text. There is deliberately no `cause`: the native
 * error is classified and dropped.
 */
export class KeychainError extends Error {
  constructor(
    readonly code: KeychainErrorCode,
    readonly operation: KeychainOperation,
    message: string,
  ) {
    super(message);
    this.name = "KeychainError";
  }
}

/** The manifest account for a provider's OAuth tokens: `oauth.<provider>`. Holds no secret. */
export function oauthManifestAccount(providerId: string): string {
  keychainAccount(providerId);
  return `oauth.${providerId}`;
}

/** The keychain account for a provider's API key: `apiKey.<provider>`, like the extension. */
export function keychainAccount(providerId: string): string {
  if (!PROVIDER_ID.test(providerId)) {
    throw new KeychainError("invalid", "get", "Invalid provider id");
  }
  return `apiKey.${providerId}`;
}

const NO_PLAINTEXT = "Blame never saves keys to a plaintext file.";

function unavailableMessage(platform: NodeJS.Platform): string {
  const where =
    platform === "linux"
      ? "On Linux the blame CLI needs a Secret Service keyring (GNOME Keyring, KWallet or KeePassXC) that is running and unlocked. SSH sessions, CI and containers usually have none."
      : platform === "darwin"
        ? "On macOS the blame CLI uses the login keychain."
        : platform === "win32"
          ? "On Windows the blame CLI uses Credential Manager."
          : `The blame CLI has no keychain support on ${platform}.`;
  return `Blame could not reach the OS keychain. ${where} Start or unlock a keychain and try again, or set your provider's API key environment variable for this shell instead (for example OPENAI_API_KEY). ${NO_PLAINTEXT}`;
}

const LOCKED =
  /\block(ed)?\b|interaction ?not ?allowed|user ?cancel|-25308|-128\b|isLocked|prompt dismissed/i;
const TOO_LONG = /too ?long|TooLong/;
const UNAVAILABLE =
  /secret ?service|d-?bus|org\.freedesktop|no ?storage ?access|NoStorageAccess|platform ?secure ?storage|not ?available|unavailable|ServiceUnknown|no such interface|keyutils/i;

function classify(
  error: unknown,
  operation: KeychainOperation,
  platform: NodeJS.Platform,
): KeychainError {
  if (error instanceof KeychainError) return error;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (LOCKED.test(text)) {
    return new KeychainError(
      "keychain_locked",
      operation,
      `The OS keychain is locked or the access prompt was dismissed. Unlock it (on Linux, unlock your Secret Service keyring; on macOS, the login keychain) and try again. ${NO_PLAINTEXT}`,
    );
  }
  if (TOO_LONG.test(text)) return tooLong(operation);
  if (UNAVAILABLE.test(text)) {
    return new KeychainError("keychain_unavailable", operation, unavailableMessage(platform));
  }
  return new KeychainError(
    "keychain_error",
    operation,
    `The OS keychain refused the ${operation} request. Check that your keychain is unlocked and try again. ${NO_PLAINTEXT}`,
  );
}

function tooLong(operation: KeychainOperation): KeychainError {
  return new KeychainError(
    "too_long",
    operation,
    `This value is too long for Windows Credential Manager, which holds at most ${WINDOWS_MAX_SECRET_BYTES} bytes per entry.`,
  );
}

export interface KeychainKeyStoreOptions {
  /** Loads the native module. Defaults to a dynamic import of `@napi-rs/keyring`. */
  readonly loadKeyring?: () => Promise<KeyringModule>;
  /** Defaults to `process.platform`. */
  readonly platform?: NodeJS.Platform;
}

const loadNapiKeyring = async (): Promise<KeyringModule> =>
  (await import("@napi-rs/keyring")) as unknown as KeyringModule;

export class KeychainKeyStore implements KeyStore, OAuthTokenStore {
  readonly #load: () => Promise<KeyringModule>;
  readonly #platform: NodeJS.Platform;
  #module: Promise<KeyringModule> | undefined;
  /** Writes touch the key and the index, so they run one at a time in this process. */
  #writes: Promise<unknown> = Promise.resolve();

  constructor(options: KeychainKeyStoreOptions = {}) {
    this.#load = options.loadKeyring ?? loadNapiKeyring;
    this.#platform = options.platform ?? process.platform;
  }

  async get(providerId: string): Promise<string | undefined> {
    const account = keychainAccount(providerId);
    return this.#call(
      "get",
      async () => (await (await this.#entry(account)).getPassword()) ?? undefined,
    );
  }

  async set(providerId: string, key: string): Promise<void> {
    const account = keychainAccount(providerId);
    const value = key.trim();
    if (value.length === 0) throw new KeychainError("invalid", "set", "Key is empty");
    if (
      this.#platform === "win32" &&
      Buffer.byteLength(value, "utf16le") > WINDOWS_MAX_SECRET_BYTES
    ) {
      throw tooLong("set");
    }
    await this.#serialize(() =>
      this.#call("set", async () => {
        await (await this.#entry(account)).setPassword(value);
        const ids = await this.#readIndex();
        if (!ids.includes(providerId)) await this.#writeIndex([...ids, providerId]);
      }),
    );
  }

  async delete(providerId: string): Promise<void> {
    const account = keychainAccount(providerId);
    await this.#serialize(() =>
      this.#call("delete", async () => {
        await (await this.#entry(account)).deletePassword();
        const ids = await this.#readIndex();
        if (ids.includes(providerId)) await this.#writeIndex(ids.filter((id) => id !== providerId));
      }),
    );
  }

  /**
   * Provider ids with a stored key, from Blame's index entry. The index avoids enumerating the
   * keychain, which would read every secret value (and can prompt once per item on macOS).
   */
  async list(): Promise<string[]> {
    return this.#call("list", () => this.#readIndex());
  }

  /**
   * ChatGPT sign-in tokens (FR-KEY-3), only for providers on the auth policy's OAuth allowlist.
   * Layout under service `blame`: `oauth.<provider>` is a manifest `{"v":1,"gen":...,"chunks":n}`
   * with no secret, and `oauth.<provider>.<gen>.<i>` hold the token JSON in chunks. A refresh writes
   * a new generation, switches the manifest, then deletes the old chunks, so a crash mid-write
   * leaves the previous sign-in readable.
   */
  async getOAuth(providerId: string): Promise<OAuthTokens | undefined> {
    const manifestAccount = oauthManifestAccount(providerId);
    try {
      assertOAuthAllowed(providerId);
    } catch {
      return undefined;
    }
    return this.#call("get", async () => {
      const manifest = await this.#readManifest(manifestAccount);
      if (manifest === undefined) return undefined;
      let json = "";
      for (let i = 0; i < manifest.chunks; i++) {
        const part = await (
          await this.#entry(`${manifestAccount}.${manifest.gen}.${i}`)
        ).getPassword();
        if (part === null) throw corrupt("get");
        json += part;
      }
      const tokens = parseTokens(json);
      if (tokens === undefined) throw corrupt("get");
      return tokens;
    });
  }

  async setOAuth(providerId: string, tokens: OAuthTokens): Promise<void> {
    const manifestAccount = oauthManifestAccount(providerId);
    assertOAuthAllowed(providerId);
    if (!isTokens(tokens)) {
      throw new KeychainError("invalid", "set", "Sign-in tokens are incomplete; sign in again.");
    }
    const json = asciiJson(tokens);
    const chunks: string[] = [];
    for (let i = 0; i < json.length; i += OAUTH_CHUNK_CHARS) {
      chunks.push(json.slice(i, i + OAUTH_CHUNK_CHARS));
    }
    if (chunks.length > OAUTH_MAX_CHUNKS) throw tooLong("set");
    await this.#serialize(() =>
      this.#call("set", async () => {
        const previous = await this.#readManifest(manifestAccount).catch(() => undefined);
        const gen = randomBytes(8).toString("hex");
        for (const [i, chunk] of chunks.entries()) {
          await (await this.#entry(`${manifestAccount}.${gen}.${i}`)).setPassword(chunk);
        }
        await (await this.#entry(manifestAccount)).setPassword(
          JSON.stringify({ v: 1, gen, chunks: chunks.length }),
        );
        if (previous) await this.#deleteChunks(manifestAccount, previous);
        const ids = await this.#readList(KEYCHAIN_OAUTH_INDEX_ACCOUNT);
        if (!ids.includes(providerId)) {
          await this.#writeList(KEYCHAIN_OAUTH_INDEX_ACCOUNT, [...ids, providerId]);
        }
      }),
    );
  }

  /** Logout. Works on a damaged entry too. */
  async deleteOAuth(providerId: string): Promise<void> {
    const manifestAccount = oauthManifestAccount(providerId);
    await this.#serialize(() =>
      this.#call("delete", async () => {
        const manifest = await this.#readManifest(manifestAccount).catch(() => undefined);
        if (manifest) await this.#deleteChunks(manifestAccount, manifest);
        await (await this.#entry(manifestAccount)).deletePassword();
        const ids = await this.#readList(KEYCHAIN_OAUTH_INDEX_ACCOUNT);
        if (ids.includes(providerId)) {
          await this.#writeList(
            KEYCHAIN_OAUTH_INDEX_ACCOUNT,
            ids.filter((id) => id !== providerId),
          );
        }
      }),
    );
  }

  async listOAuth(): Promise<string[]> {
    return this.#call("list", () => this.#readList(KEYCHAIN_OAUTH_INDEX_ACCOUNT));
  }

  async #readManifest(account: string): Promise<{ gen: string; chunks: number } | undefined> {
    const raw = await (await this.#entry(account)).getPassword();
    if (raw === null) return undefined;
    try {
      const m = JSON.parse(raw) as { v?: unknown; gen?: unknown; chunks?: unknown };
      if (
        m.v === 1 &&
        typeof m.gen === "string" &&
        OAUTH_GENERATION.test(m.gen) &&
        Number.isInteger(m.chunks) &&
        (m.chunks as number) > 0 &&
        (m.chunks as number) <= OAUTH_MAX_CHUNKS
      ) {
        return { gen: m.gen, chunks: m.chunks as number };
      }
    } catch {
      // Fall through.
    }
    throw corrupt("get");
  }

  async #deleteChunks(account: string, manifest: { gen: string; chunks: number }): Promise<void> {
    for (let i = 0; i < manifest.chunks; i++) {
      await (await this.#entry(`${account}.${manifest.gen}.${i}`)).deletePassword();
    }
  }

  async #readIndex(): Promise<string[]> {
    return this.#readList(KEYCHAIN_INDEX_ACCOUNT);
  }

  async #writeIndex(ids: string[]): Promise<void> {
    return this.#writeList(KEYCHAIN_INDEX_ACCOUNT, ids);
  }

  async #readList(account: string): Promise<string[]> {
    const raw = await (await this.#entry(account)).getPassword();
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string" && PROVIDER_ID.test(id))
        : [];
    } catch {
      return [];
    }
  }

  async #writeList(account: string, ids: string[]): Promise<void> {
    const entry = await this.#entry(account);
    if (ids.length === 0) await entry.deletePassword();
    else await entry.setPassword(JSON.stringify([...new Set(ids)].sort()));
  }

  async #entry(account: string): Promise<KeyringEntry> {
    this.#module ??= this.#load().catch((error: unknown) => {
      this.#module = undefined;
      throw new KeychainError(
        "keychain_unavailable",
        "load",
        `${unavailableMessage(this.#platform)} The keychain module could not load${
          error instanceof Error && /cannot find module/i.test(error.message)
            ? " (no prebuilt binary for this platform)"
            : ""
        }.`,
      );
    });
    const { AsyncEntry } = await this.#module;
    // Pin Linux to Secret Service: without this the binding silently falls back to the kernel
    // keyutils keyring, which forgets every key at reboot.
    return this.#platform === "linux"
      ? new AsyncEntry(KEYCHAIN_SERVICE, account, { linux: { store: "secret-service" } })
      : new AsyncEntry(KEYCHAIN_SERVICE, account);
  }

  async #call<T>(operation: KeychainOperation, task: () => Promise<T>): Promise<T> {
    try {
      return await task();
    } catch (error) {
      throw classify(error, operation, this.#platform);
    }
  }

  #serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.#writes.then(task, task);
    this.#writes = next.catch(() => undefined);
    return next;
  }
}

function corrupt(operation: KeychainOperation): KeychainError {
  return new KeychainError(
    "corrupt",
    operation,
    "The saved ChatGPT sign-in in the OS keychain is damaged. Sign out and sign in again.",
  );
}

function isTokens(x: unknown): x is OAuthTokens {
  if (typeof x !== "object" || x === null) return false;
  const t = x as Record<string, unknown>;
  return (
    typeof t.access === "string" &&
    t.access.length > 0 &&
    typeof t.refresh === "string" &&
    t.refresh.length > 0 &&
    typeof t.expires === "number" &&
    Number.isFinite(t.expires)
  );
}

function parseTokens(json: string): OAuthTokens | undefined {
  try {
    const parsed: unknown = JSON.parse(json);
    return isTokens(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** JSON with every non-ASCII code unit escaped, so fixed-size chunks never split a character. */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u0080-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export type CliKeyStoreBackend = "keychain" | "memory";

/**
 * The CLI's key store. The OS keychain unless the caller explicitly asks for `memory`, which keeps
 * keys for this process only (tests, or a user who wants nothing persisted).
 */
export function createCliKeyStore(
  options: { readonly backend?: CliKeyStoreBackend } & KeychainKeyStoreOptions = {},
): KeyStore {
  const { backend = "keychain", ...keychain } = options;
  return backend === "memory" ? new InMemoryKeyStore() : new KeychainKeyStore(keychain);
}

import type { OAuthCredentials } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import {
  BlameAuthPolicyError,
  createBlameModelRuntime,
  InMemoryKeyStore,
  type KeyStore,
  keyStoreCredentials,
  parseClientMessage,
  policyCredentialStore,
  supportsOAuth,
} from "../src/index.js";

// Obviously fake values. gitleaks runs on every PR.
const FAKE_ACCESS = "fake-access-token-for-tests-0001";
const FAKE_REFRESH = "fake-refresh-token-for-tests-0001";
const FAKE_ACCESS_2 = "fake-access-token-for-tests-0002";
const FAKE_REFRESH_2 = "fake-refresh-token-for-tests-0002";
const FAR_FUTURE = Date.now() + 60 * 60 * 1000;

const tokens = (access = FAKE_ACCESS, refresh = FAKE_REFRESH): OAuthCredentials => ({
  access,
  refresh,
  expires: FAR_FUTURE,
  accountId: "fake-account",
});

/** A KeyStore with no OAuth support, like a third-party backend. */
class ApiKeyOnlyStore implements KeyStore {
  readonly #inner = new InMemoryKeyStore();
  get = (p: string) => this.#inner.get(p);
  set = (p: string, k: string) => this.#inner.set(p, k);
  delete = (p: string) => this.#inner.delete(p);
  list = () => this.#inner.list();
}

describe("OAuth token storage through the KeyStore", () => {
  it("InMemoryKeyStore supports OAuth; an API-key-only store does not", () => {
    expect(supportsOAuth(new InMemoryKeyStore())).toBe(true);
    expect(supportsOAuth(new ApiKeyOnlyStore())).toBe(false);
  });

  it("stores ChatGPT sign-in tokens for openai and openai-codex and reads them back", async () => {
    const keys = new InMemoryKeyStore();
    const store = policyCredentialStore(keyStoreCredentials(keys));
    for (const provider of ["openai", "openai-codex"]) {
      await store.modify(provider, async () => ({ type: "oauth", ...tokens() }));
      expect(await store.read(provider)).toEqual({ type: "oauth", ...tokens() });
      expect(await keys.getOAuth(provider)).toEqual(tokens());
    }
    expect(await store.list()).toEqual([
      { providerId: "openai", type: "oauth" },
      { providerId: "openai-codex", type: "oauth" },
    ]);
  });

  it("refuses OAuth for providers the auth policy blocks, at both layers", async () => {
    const keys = new InMemoryKeyStore();
    const inner = keyStoreCredentials(keys);
    const store = policyCredentialStore(inner);
    for (const s of [store, inner]) {
      const error = await s
        .modify("anthropic", async () => ({ type: "oauth", ...tokens() }))
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BlameAuthPolicyError);
      expect(String((error as Error).message)).not.toContain(FAKE_ACCESS);
    }
    expect(await keys.listOAuth()).toEqual([]);
    // A token planted directly in the backing store (another tool) is never served.
    await keys.setOAuth("anthropic", tokens());
    expect(await store.read("anthropic")).toBeUndefined();
    expect(await inner.read("anthropic")).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it("still refuses OAuth when the KeyStore cannot hold tokens", async () => {
    const store = keyStoreCredentials(new ApiKeyOnlyStore());
    await expect(
      store.modify("openai", async () => ({ type: "oauth", ...tokens() })),
    ).rejects.toThrow("does not support OAuth");
  });

  it("writes refreshed tokens back through modify, serialized per provider", async () => {
    const keys = new InMemoryKeyStore();
    const store = keyStoreCredentials(keys);
    await store.modify("openai-codex", async () => ({ type: "oauth", ...tokens() }));
    const seen: string[] = [];
    const refresh = (access: string, refreshToken: string) =>
      store.modify("openai-codex", async (current) => {
        if (current?.type === "oauth") seen.push(current.access);
        await new Promise((r) => setTimeout(r, 5));
        return { type: "oauth", ...tokens(access, refreshToken) };
      });
    await Promise.all([refresh(FAKE_ACCESS_2, FAKE_REFRESH_2), refresh("a3", "r3")]);
    // The second refresh saw the first one's rotated token, never the stale one twice.
    expect(seen).toEqual([FAKE_ACCESS, FAKE_ACCESS_2]);
    expect(await keys.getOAuth("openai-codex")).toEqual(tokens("a3", "r3"));
  });

  it("one credential per provider: an OAuth sign-in replaces an API key and the reverse", async () => {
    const keys = new InMemoryKeyStore();
    const store = keyStoreCredentials(keys);
    await store.modify("openai", async () => ({ type: "api_key", key: "fake-key-for-tests" }));
    await store.modify("openai", async () => ({ type: "oauth", ...tokens() }));
    expect(await keys.get("openai")).toBeUndefined();
    expect(await store.list()).toEqual([{ providerId: "openai", type: "oauth" }]);
    await store.modify("openai", async () => ({ type: "api_key", key: "fake-key-for-tests" }));
    expect(await keys.getOAuth("openai")).toBeUndefined();
    expect(await store.read("openai")).toEqual({ type: "api_key", key: "fake-key-for-tests" });
  });

  it("logout deletes the stored tokens", async () => {
    const keys = new InMemoryKeyStore();
    const store = policyCredentialStore(keyStoreCredentials(keys));
    await store.modify("openai", async () => ({ type: "oauth", ...tokens() }));
    await store.delete("openai");
    expect(await keys.getOAuth("openai")).toBeUndefined();
    expect(await store.read("openai")).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it("list never exposes token values", async () => {
    const keys = new InMemoryKeyStore();
    const store = keyStoreCredentials(keys);
    await store.modify("openai", async () => ({ type: "oauth", ...tokens() }));
    const listed = JSON.stringify([await store.list(), await keys.listOAuth()]);
    expect(listed).not.toContain(FAKE_ACCESS);
    expect(listed).not.toContain(FAKE_REFRESH);
  });

  it("Pi resolves a stored ChatGPT sign-in from the Blame store without auth.json", async () => {
    const keys = new InMemoryKeyStore();
    await keys.setOAuth("openai-codex", tokens());
    const runtime = await createBlameModelRuntime({ keys });
    const auth = await runtime.getAuth("openai-codex");
    expect(auth?.auth.apiKey).toBe(FAKE_ACCESS);
  });

  it("keeps tokens out of console output during sign-in, refresh and logout", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    try {
      const keys = new InMemoryKeyStore();
      const store = policyCredentialStore(keyStoreCredentials(keys));
      await store.modify("openai", async () => ({ type: "oauth", ...tokens() }));
      await store.modify("openai", async () => ({ type: "oauth", ...tokens(FAKE_ACCESS_2) }));
      await store.modify("anthropic", async () => ({ type: "oauth", ...tokens() })).catch(() => {});
      await store.delete("openai");
      for (const spy of spies) {
        for (const call of spy.mock.calls) {
          const text = JSON.stringify(call);
          for (const secret of [FAKE_ACCESS, FAKE_ACCESS_2, FAKE_REFRESH]) {
            expect(text).not.toContain(secret);
          }
        }
      }
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("engine protocol and OAuth tokens", () => {
  const init = (extra: Record<string, unknown>) =>
    JSON.stringify({
      v: 1,
      type: "request",
      id: "1",
      method: "init",
      params: {
        cwd: "/tmp/x",
        model: { providerId: "openai", modelId: "gpt-5" },
        policyContext: {
          presetId: "guided",
          earnedLevelId: "L2",
          optedIn: false,
          sandboxAvailable: false,
        },
        ...extra,
      },
    });

  it("refuses an init that tries to carry OAuth tokens, without echoing them", () => {
    for (const extra of [
      { oauth: tokens() },
      { credentials: { type: "oauth", ...tokens() } },
      { access: FAKE_ACCESS },
      { refresh: FAKE_REFRESH },
      { accessToken: FAKE_ACCESS },
      { refreshToken: FAKE_REFRESH },
    ]) {
      const parsed = parseClientMessage(init(extra));
      expect(parsed.ok).toBe(false);
      const text = JSON.stringify(parsed);
      expect(text).not.toContain(FAKE_ACCESS);
      expect(text).not.toContain(FAKE_REFRESH);
      expect(text).toContain("OAuth");
    }
  });
});

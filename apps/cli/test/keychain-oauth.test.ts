import { BlameAuthPolicyError, keyStoreCredentials, policyCredentialStore } from "@blame-ai/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeychainError, KeychainKeyStore, OAUTH_CHUNK_CHARS } from "../src/keys/keychain.js";
import { fakeKeyring } from "./fake-keyring.js";

// Obviously fake values. gitleaks runs on every PR.
const FAKE_ACCESS = "fake-access-token-for-tests-0001";
const FAKE_REFRESH = "fake-refresh-token-for-tests-0001";

const tokens = (access = FAKE_ACCESS, refresh = FAKE_REFRESH) => ({
  access,
  refresh,
  expires: 1_900_000_000_000,
  accountId: "fake-account",
});

function storeWith(keyring = fakeKeyring(), platform: NodeJS.Platform = "win32") {
  return { keyring, store: new KeychainKeyStore({ loadKeyring: async () => keyring, platform }) };
}

describe("KeychainKeyStore OAuth tokens", () => {
  it("round-trips ChatGPT sign-in tokens for openai and openai-codex", async () => {
    const { store } = storeWith();
    expect(await store.getOAuth("openai")).toBeUndefined();
    await store.setOAuth("openai", tokens());
    await store.setOAuth("openai-codex", tokens());
    expect(await store.getOAuth("openai")).toEqual(tokens());
    expect(await store.listOAuth()).toEqual(["openai", "openai-codex"]);
    await store.deleteOAuth("openai");
    expect(await store.getOAuth("openai")).toBeUndefined();
    expect(await store.listOAuth()).toEqual(["openai-codex"]);
    await store.deleteOAuth("openai");
  });

  it("refuses OAuth for providers the auth policy blocks", async () => {
    const { store, keyring } = storeWith();
    await expect(store.setOAuth("anthropic", tokens())).rejects.toBeInstanceOf(
      BlameAuthPolicyError,
    );
    expect(keyring.entries.size).toBe(0);
    expect(await store.getOAuth("anthropic")).toBeUndefined();
  });

  it("splits realistic JWT-sized tokens into entries under the Windows 2560-byte limit", async () => {
    const { store, keyring } = storeWith(fakeKeyring(), "win32");
    const big = tokens(`fake-${"a".repeat(3000)}`, `fake-${"r".repeat(1500)}`);
    await store.setOAuth("openai-codex", { ...big, note: "caf\u00e9 \u{1F600}" });
    for (const [id, value] of keyring.entries) {
      expect(Buffer.byteLength(value, "utf16le"), id).toBeLessThanOrEqual(2560);
      expect(value.length).toBeLessThanOrEqual(OAUTH_CHUNK_CHARS);
    }
    expect(await store.getOAuth("openai-codex")).toEqual({ ...big, note: "caf\u00e9 \u{1F600}" });
  });

  it("keeps the manifest and index free of token values", async () => {
    const { store, keyring } = storeWith();
    await store.setOAuth("openai", tokens());
    for (const [id, value] of keyring.entries) {
      if (id.endsWith("\u0000oauth.openai") || id.endsWith("\u0000index.oauth")) {
        expect(value).not.toContain(FAKE_ACCESS);
        expect(value).not.toContain(FAKE_REFRESH);
      }
    }
  });

  it("writes a refresh as a new generation, then removes the old chunks", async () => {
    const { store, keyring } = storeWith();
    await store.setOAuth("openai", tokens());
    const before = keyring.entries.size;
    await store.setOAuth("openai", tokens("fake-access-rotated", "fake-refresh-rotated"));
    expect(keyring.entries.size).toBe(before);
    expect(await store.getOAuth("openai")).toEqual(
      tokens("fake-access-rotated", "fake-refresh-rotated"),
    );
    expect([...keyring.entries.values()].join("\n")).not.toContain(FAKE_ACCESS);
  });

  it("logout removes every entry for the provider", async () => {
    const { store, keyring } = storeWith();
    await store.setOAuth("openai", tokens(`fake-${"a".repeat(3000)}`));
    await store.deleteOAuth("openai");
    expect(keyring.entries.size).toBe(0);
  });

  it("reports a damaged entry as corrupt without echoing it", async () => {
    const { store, keyring } = storeWith();
    await store.setOAuth("openai", tokens());
    for (const id of keyring.entries.keys()) {
      if (/oauth\.openai\.[0-9a-f]+\.0$/.test(id)) keyring.entries.delete(id);
    }
    const error = await store.getOAuth("openai").catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "corrupt" });
    expect(JSON.stringify(error) + String(error)).not.toContain(FAKE_REFRESH);
    // Logout still works on a damaged entry.
    await store.deleteOAuth("openai");
    expect(await store.getOAuth("openai")).toBeUndefined();
  });

  it("feeds Pi's CredentialStore: sign-in, refresh write-back and logout", async () => {
    const { store, keyring } = storeWith();
    const credentials = policyCredentialStore(keyStoreCredentials(store));
    await credentials.modify("openai-codex", async () => ({ type: "oauth", ...tokens() }));
    expect(await credentials.read("openai-codex")).toEqual({ type: "oauth", ...tokens() });
    await credentials.modify("openai-codex", async (current) => {
      expect(current).toMatchObject({ refresh: FAKE_REFRESH });
      return { type: "oauth", ...tokens("fake-access-2", "fake-refresh-2") };
    });
    expect(await store.getOAuth("openai-codex")).toEqual(tokens("fake-access-2", "fake-refresh-2"));
    await expect(
      credentials.modify("anthropic", async () => ({ type: "oauth", ...tokens() })),
    ).rejects.toBeInstanceOf(BlameAuthPolicyError);
    await credentials.delete("openai-codex");
    expect(keyring.entries.size).toBe(0);
  });
});

describe("KeychainKeyStore OAuth never leaks a token", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps tokens out of errors and console output when the keychain fails", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const keyring = fakeKeyring();
    keyring.failWith = new Error(`Platform failure while writing ${FAKE_ACCESS} ${FAKE_REFRESH}`);
    const { store } = storeWith(keyring, "linux");
    const errors: unknown[] = [];
    for (const call of [
      () => store.setOAuth("openai", tokens()),
      () => store.getOAuth("openai"),
      () => store.deleteOAuth("openai"),
      () => store.listOAuth(),
    ]) {
      errors.push(
        await call().then(
          () => undefined,
          (e: unknown) => e,
        ),
      );
    }
    for (const error of errors) {
      expect(error).toBeInstanceOf(KeychainError);
      const e = error as KeychainError;
      const rendered = [e.message, e.stack ?? "", String(e), JSON.stringify(e)].join("\n");
      expect(rendered).not.toContain(FAKE_ACCESS);
      expect(rendered).not.toContain(FAKE_REFRESH);
      expect((e as { cause?: unknown }).cause).toBeUndefined();
    }
    for (const spy of spies) {
      for (const c of spy.mock.calls) {
        expect(JSON.stringify(c)).not.toContain(FAKE_ACCESS);
        expect(JSON.stringify(c)).not.toContain(FAKE_REFRESH);
      }
    }
  });

  it("refuses malformed tokens without echoing them", async () => {
    const { store } = storeWith();
    const error = await store
      .setOAuth("openai", { access: FAKE_ACCESS, refresh: 5, expires: 1 } as never)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "invalid" });
    expect(String(error)).not.toContain(FAKE_ACCESS);
  });
});

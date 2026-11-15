import { InMemoryKeyStore } from "@blame-ai/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCliKeyStore,
  KEYCHAIN_SERVICE,
  KeychainError,
  KeychainKeyStore,
  keychainAccount,
} from "../src/keys/keychain.js";
import { fakeKeyring } from "./fake-keyring.js";

// Obviously fake values. gitleaks runs on every PR.
const FAKE_KEY = "fake-key-for-tests-0001";
const OTHER_FAKE_KEY = "fake-key-for-tests-0002";

function storeWith(keyring = fakeKeyring(), platform: NodeJS.Platform = "darwin") {
  return { keyring, store: new KeychainKeyStore({ loadKeyring: async () => keyring, platform }) };
}

describe("KeychainKeyStore naming", () => {
  it("uses the blame service and the same apiKey.<provider> naming as the extension", () => {
    expect(KEYCHAIN_SERVICE).toBe("blame");
    expect(keychainAccount("openai")).toBe("apiKey.openai");
    expect(keychainAccount("openai-codex")).toBe("apiKey.openai-codex");
  });

  it("rejects provider ids the extension would reject", () => {
    for (const bad of ["", "OpenAI", "../x", "a b", "-lead", "x".repeat(65)]) {
      expect(() => keychainAccount(bad)).toThrow(KeychainError);
    }
  });
});

describe("KeychainKeyStore with a mocked native module", () => {
  it("round-trips get, set, list and delete", async () => {
    const { store, keyring } = storeWith();
    expect(await store.get("openai")).toBeUndefined();
    expect(await store.list()).toEqual([]);
    await store.set("openai", FAKE_KEY);
    await store.set("anthropic", OTHER_FAKE_KEY);
    expect(await store.get("openai")).toBe(FAKE_KEY);
    expect((await store.list()).sort()).toEqual(["anthropic", "openai"]);
    expect(keyring.entries.get(`blame\u0000apiKey.openai`)).toBe(FAKE_KEY);
    await store.delete("openai");
    expect(await store.get("openai")).toBeUndefined();
    expect(await store.list()).toEqual(["anthropic"]);
    // Deleting a key that is not there is not an error.
    await store.delete("openai");
  });

  it("keeps the provider index free of secret values", async () => {
    const { store, keyring } = storeWith();
    await store.set("openai", FAKE_KEY);
    const index = keyring.entries.get(`blame\u0000index.apiKey`);
    expect(index).toBeDefined();
    expect(JSON.parse(index ?? "null")).toEqual(["openai"]);
    expect(index).not.toContain(FAKE_KEY);
  });

  it("trims keys and refuses an empty key", async () => {
    const { store } = storeWith();
    await store.set("openai", `  ${FAKE_KEY}\n`);
    expect(await store.get("openai")).toBe(FAKE_KEY);
    await expect(store.set("openai", "   ")).rejects.toThrow("empty");
  });

  it("pins Linux to Secret Service so a missing keyring is an error, not a silent keyutils fallback", async () => {
    const { store, keyring } = storeWith(fakeKeyring(), "linux");
    await store.set("openai", FAKE_KEY);
    expect(
      keyring.constructed.every(
        (c) => JSON.stringify(c.options) === '{"linux":{"store":"secret-service"}}',
      ),
    ).toBe(true);
  });

  it("passes no options on macOS and Windows", async () => {
    for (const platform of ["darwin", "win32"] as const) {
      const { store, keyring } = storeWith(fakeKeyring(), platform);
      await store.get("openai");
      expect(keyring.constructed.every((c) => c.options === undefined)).toBe(true);
    }
  });

  it("refuses a value over the Windows Credential Manager limit with a clear message", async () => {
    const { store } = storeWith(fakeKeyring(), "win32");
    await expect(store.set("openai", "k".repeat(1281))).rejects.toMatchObject({
      code: "too_long",
    });
    await store.set("openai", "k".repeat(1280));
  });

  it("loads the native module lazily, once, and not at construction", async () => {
    const keyring = fakeKeyring();
    const load = vi.fn(async () => keyring);
    const store = new KeychainKeyStore({ loadKeyring: load, platform: "darwin" });
    expect(load).not.toHaveBeenCalled();
    await store.get("openai");
    await store.list();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("serializes writes so concurrent sets keep every provider in the index", async () => {
    const { store } = storeWith();
    await Promise.all(["a1", "a2", "a3", "a4", "a5"].map((p) => store.set(p, FAKE_KEY)));
    expect((await store.list()).sort()).toEqual(["a1", "a2", "a3", "a4", "a5"]);
  });
});

describe("KeychainKeyStore when the keychain is missing or locked", () => {
  it("reports a missing native binary as keychain_unavailable with next steps", async () => {
    const store = new KeychainKeyStore({
      loadKeyring: async () => {
        throw new Error("Cannot find module '@napi-rs/keyring-linux-x64-gnu'");
      },
      platform: "linux",
    });
    const error = await store.get("openai").then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(KeychainError);
    expect(error).toMatchObject({ code: "keychain_unavailable" });
    expect((error as Error).message).toContain("OPENAI_API_KEY");
  });

  it("reports headless Linux with no Secret Service as keychain_unavailable", async () => {
    const keyring = fakeKeyring();
    keyring.failWith = new Error(
      "Platform secure storage failure: org.freedesktop.DBus.Error.ServiceUnknown: The name org.freedesktop.secrets was not provided",
    );
    keyring.failInConstructor = true;
    const { store } = storeWith(keyring, "linux");
    await expect(store.set("openai", FAKE_KEY)).rejects.toMatchObject({
      code: "keychain_unavailable",
    });
    await expect(store.get("openai")).rejects.toThrow(/Secret Service/);
  });

  it("reports a locked keychain as keychain_locked", async () => {
    const keyring = fakeKeyring();
    keyring.failWith = new Error("Couldn't access platform secure storage: keychain is locked");
    const { store } = storeWith(keyring, "darwin");
    await expect(store.get("openai")).rejects.toMatchObject({ code: "keychain_locked" });
  });

  it("never falls back to a plaintext file or an environment variable", async () => {
    const keyring = fakeKeyring();
    keyring.failWith = new Error("No storage access");
    const { store } = storeWith(keyring, "linux");
    const before = { ...process.env };
    process.env.OPENAI_API_KEY = FAKE_KEY;
    try {
      // An env var is the user's own choice for Pi to read; the store never reads or writes one.
      await expect(store.get("openai")).rejects.toBeInstanceOf(KeychainError);
      await expect(store.set("openai", OTHER_FAKE_KEY)).rejects.toBeInstanceOf(KeychainError);
      expect(process.env.OPENAI_API_KEY).toBe(FAKE_KEY);
      expect(Object.keys(process.env).sort()).toEqual(
        Object.keys({ ...before, OPENAI_API_KEY: "" }).sort(),
      );
    } finally {
      process.env = before;
    }
  });
});

describe("KeychainKeyStore never leaks a key", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the key out of error messages, stacks, causes and console output", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const keyring = fakeKeyring();
    // A hostile native error that echoes the secret it was given.
    keyring.failWith = new Error(`Platform secure storage failure while writing ${FAKE_KEY}`);
    const { store } = storeWith(keyring, "win32");
    const errors: unknown[] = [];
    for (const call of [
      () => store.set("openai", FAKE_KEY),
      () => store.get("openai"),
      () => store.delete("openai"),
      () => store.list(),
    ]) {
      errors.push(
        await call().then(
          () => undefined,
          (e: unknown) => e,
        ),
      );
    }
    errors.push(
      await store.set("openai", `${FAKE_KEY}${"x".repeat(2000)}`).catch((e: unknown) => e),
    );
    for (const error of errors) {
      expect(error).toBeInstanceOf(KeychainError);
      const e = error as KeychainError;
      const rendered = [
        e.message,
        e.stack ?? "",
        String(e),
        JSON.stringify(e),
        JSON.stringify(Object.getOwnPropertyDescriptors(e)),
        String((e as { cause?: unknown }).cause ?? ""),
      ].join("\n");
      expect(rendered).not.toContain(FAKE_KEY);
      expect((e as { cause?: unknown }).cause).toBeUndefined();
    }
    for (const spy of spies) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(FAKE_KEY);
    }
  });
});

describe("createCliKeyStore", () => {
  it("defaults to the OS keychain", () => {
    expect(createCliKeyStore()).toBeInstanceOf(KeychainKeyStore);
  });

  it("returns an in-memory store only when asked explicitly", () => {
    expect(createCliKeyStore({ backend: "memory" })).toBeInstanceOf(InMemoryKeyStore);
  });
});

import { describe, expect, it } from "vitest";
import { createBlameModelRuntime, InMemoryKeyStore, keyStoreCredentials } from "../src/index.js";

describe("InMemoryKeyStore", () => {
  it("stores, lists and deletes provider keys", async () => {
    const keys = new InMemoryKeyStore();
    expect(await keys.get("openai")).toBeUndefined();
    await keys.set("openai", "sk-test-1");
    await keys.set("anthropic", "sk-test-2");
    expect(await keys.get("openai")).toBe("sk-test-1");
    expect((await keys.list()).sort()).toEqual(["anthropic", "openai"]);
    await keys.delete("openai");
    expect(await keys.get("openai")).toBeUndefined();
    expect(await keys.list()).toEqual(["anthropic"]);
  });
});

describe("keyStoreCredentials", () => {
  it("exposes stored keys to Pi as api_key credentials", async () => {
    const keys = new InMemoryKeyStore();
    await keys.set("anthropic", "sk-test-2");
    const store = keyStoreCredentials(keys);
    expect(await store.read("anthropic")).toEqual({ type: "api_key", key: "sk-test-2" });
    expect(await store.read("openai")).toBeUndefined();
    expect(await store.list()).toEqual([{ providerId: "anthropic", type: "api_key" }]);
  });

  it("writes api keys through modify and refuses OAuth credentials for now", async () => {
    const keys = new InMemoryKeyStore();
    const store = keyStoreCredentials(keys);
    await store.modify("openai", async () => ({ type: "api_key", key: "sk-test-3" }));
    expect(await keys.get("openai")).toBe("sk-test-3");
    await expect(
      store.modify("openai", async () => ({
        type: "oauth",
        access: "a",
        refresh: "r",
        expires: 1,
      })),
    ).rejects.toThrow("OAuth");
    await store.delete("openai");
    expect(await keys.get("openai")).toBeUndefined();
  });

  it("feeds a Blame model runtime so Pi resolves the key without auth.json", async () => {
    const keys = new InMemoryKeyStore();
    await keys.set("anthropic", "sk-test-4");
    const runtime = await createBlameModelRuntime({ keys });
    const auth = await runtime.getAuth("anthropic");
    expect(auth?.auth.apiKey).toBe("sk-test-4");
  });
});

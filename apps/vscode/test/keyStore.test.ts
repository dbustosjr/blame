import { describe, expect, it } from "vitest";
import { KeyStore, type SecretStore } from "../src/keyStore.js";

function fakeSecrets(): SecretStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (key: string) => data.get(key),
    store: async (key: string, value: string) => {
      data.set(key, value);
    },
    delete: async (key: string) => {
      data.delete(key);
    },
  };
}

describe("KeyStore on SecretStorage", () => {
  it("stores, reads and deletes a key under a namespaced secret name", async () => {
    const secrets = fakeSecrets();
    const keys = new KeyStore(secrets);
    await keys.set("openai", "  sk-test-not-a-real-key  ");
    expect(secrets.data.get("blame.apiKey.openai")).toBe("sk-test-not-a-real-key");
    expect(await keys.get("openai")).toBe("sk-test-not-a-real-key");
    expect(await keys.has("openai")).toBe(true);
    await keys.delete("openai");
    expect(await keys.has("openai")).toBe(false);
  });

  it("rejects bad provider ids and empty keys", async () => {
    const keys = new KeyStore(fakeSecrets());
    await expect(keys.set("../etc", "x")).rejects.toThrow("Invalid provider id");
    await expect(keys.set("openai", "   ")).rejects.toThrow("Key is empty");
  });
});

describe("manifest", () => {
  it("activates on the Blame: Open command and targets a current VS Code", async () => {
    const { default: manifest } = await import("../package.json", { with: { type: "json" } });
    expect(manifest.activationEvents).toEqual(["onCommand:blame.open"]);
    expect(manifest.contributes.commands).toEqual([
      { command: "blame.open", title: "Open", category: "Blame" },
    ]);
    expect(manifest.main).toBe("./dist/extension.js");
    expect(manifest.engines.vscode).toMatch(/^\^1\.\d+\.0$/);
    expect(manifest.devDependencies["@types/vscode"]).toBe(manifest.engines.vscode.slice(1));
  });
});

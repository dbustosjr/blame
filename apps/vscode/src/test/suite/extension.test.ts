import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Blame extension", () => {
  test("registers and runs Blame: Open", async () => {
    const ext = vscode.extensions.getExtension("blame-ai.blame");
    assert.ok(ext, "extension is installed in the test host");
    await ext.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("blame.open"));
    const result = await vscode.commands.executeCommand("blame.open");
    assert.strictEqual(result, true);
  });

  test("exposes a SecretStorage key store", async () => {
    const ext = vscode.extensions.getExtension("blame-ai.blame");
    const api = (await ext?.activate()) as
      | {
          keys: {
            set(p: string, k: string): Promise<void>;
            get(p: string): Promise<string | undefined>;
            delete(p: string): Promise<void>;
          };
        }
      | undefined;
    assert.ok(api);
    await api.keys.set("test-provider", "fake-key-for-tests");
    assert.strictEqual(await api.keys.get("test-provider"), "fake-key-for-tests");
    await api.keys.delete("test-provider");
    assert.strictEqual(await api.keys.get("test-provider"), undefined);
  });
});

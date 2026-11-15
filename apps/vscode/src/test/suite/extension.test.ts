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

  test("spawns the real bundled engine with VS Code's own runtime and shuts it down", async () => {
    // Electron as Node (process.execPath with ELECTRON_RUN_AS_NODE), entry dist/engine.mjs.
    assert.ok(process.versions.electron, "running inside VS Code's Electron");
    const ext = vscode.extensions.getExtension("blame-ai.blame");
    const api = (await ext?.activate()) as
      | {
          keys: { set(p: string, k: string): Promise<void>; delete(p: string): Promise<void> };
          engine: {
            state(): Promise<{
              initialized: boolean;
              model?: { providerId: string; modelId: string };
              policyContext?: { presetId: string; optedIn: boolean; sandboxAvailable: boolean };
            }>;
            dispose(): Promise<void>;
            readonly running: boolean;
          };
        }
      | undefined;
    assert.ok(api);
    const config = vscode.workspace.getConfiguration("blame");
    await config.update("model.provider", "anthropic", vscode.ConfigurationTarget.Global);
    await config.update("model.id", "claude-sonnet-4-5", vscode.ConfigurationTarget.Global);
    await api.keys.set("anthropic", ["blame", "fake", "e2e", "key"].join("-"));
    try {
      const state = await api.engine.state();
      assert.strictEqual(state.initialized, true);
      assert.deepStrictEqual(state.model, {
        providerId: "anthropic",
        modelId: "claude-sonnet-4-5",
      });
      assert.strictEqual(state.policyContext?.optedIn, false);
      assert.strictEqual(state.policyContext?.sandboxAvailable, false);
      assert.strictEqual(api.engine.running, true);
      await api.engine.dispose();
      assert.strictEqual(api.engine.running, false);
    } finally {
      await api.keys.delete("anthropic");
      await config.update("model.id", undefined, vscode.ConfigurationTarget.Global);
      await config.update("model.provider", undefined, vscode.ConfigurationTarget.Global);
    }
  });
});

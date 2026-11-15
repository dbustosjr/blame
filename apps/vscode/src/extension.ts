import { BlameEngineClient } from "@blame-ai/core/engine-client";
import * as vscode from "vscode";
import { createModalApproval } from "./engine/approval.js";
import { EngineHost, EngineHostError, type PresetId } from "./engine/host.js";
import { KeyStore } from "./keyStore.js";

export const OPEN_COMMAND = "blame.open";
export const RUN_TASK_COMMAND = "blame.runTask";
export const STOP_COMMAND = "blame.stop";
export const SET_KEY_COMMAND = "blame.setModelKey";

export interface BlameExtensionApi {
  readonly keys: KeyStore;
  readonly engine: EngineHost;
}

let activeHost: EngineHost | undefined;

const PRESETS: readonly PresetId[] = ["manual", "guided", "autonomous"];

function readSettings() {
  const config = vscode.workspace.getConfiguration("blame");
  const preset = config.get<string>("preset", "guided");
  return {
    providerId: config.get<string>("model.provider", "anthropic"),
    modelId: config.get<string>("model.id", ""),
    presetId: (PRESETS as readonly string[]).includes(preset) ? (preset as PresetId) : "guided",
  };
}

/**
 * Activation registers commands only (FR-EXT-1, R-PERF-5). The engine child starts on the first
 * task, from the bundled dist/engine.mjs. Until the chat webview lands, the transcript goes to the
 * "Blame" output channel and approvals use a native modal.
 */
export function activate(context: vscode.ExtensionContext): BlameExtensionApi {
  const keys = new KeyStore(context.secrets);
  const transcript = vscode.window.createOutputChannel("Blame");
  const log = vscode.window.createOutputChannel("Blame Engine", { log: true });

  const engine = new EngineHost({
    entry: context.asAbsolutePath("dist/engine.mjs"),
    configDir: context.globalStorageUri.fsPath,
    createClient: (options) => new BlameEngineClient(options),
    getApiKey: (providerId) => keys.get(providerId),
    getSettings: readSettings,
    getWorkspace: () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (folder === undefined || folder.uri.scheme !== "file") return undefined;
      return { cwd: folder.uri.fsPath, trusted: vscode.workspace.isTrusted };
    },
    presentApproval: createModalApproval(vscode.window),
    log: {
      info: (m) => log.info(m),
      warn: (m) => log.warn(m),
      error: (m) => log.error(m),
    },
    transcript: { append: (t) => transcript.append(t) },
  });
  activeHost = engine;

  const setKey = async (): Promise<boolean> => {
    const { providerId } = readSettings();
    const value = await vscode.window.showInputBox({
      title: `Blame: model key for ${providerId}`,
      prompt: "Stored in VS Code's secret storage on this device. Only sent to the engine.",
      password: true,
      ignoreFocusOut: true,
    });
    if (value === undefined || value.trim() === "") return false;
    await keys.set(providerId, value);
    return true;
  };

  const showError = async (error: unknown): Promise<void> => {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof EngineHostError && error.code === "no_key") {
      const pick = await vscode.window.showErrorMessage(message, "Add a model key");
      if (pick !== undefined) await setKey();
      return;
    }
    void vscode.window.showErrorMessage(`Blame: ${message}`);
  };

  context.subscriptions.push(
    transcript,
    log,
    { dispose: () => void engine.dispose() },
    vscode.commands.registerCommand(OPEN_COMMAND, () => {
      transcript.show(true);
      return true;
    }),
    vscode.commands.registerCommand(SET_KEY_COMMAND, setKey),
    vscode.commands.registerCommand(STOP_COMMAND, () => engine.abort()),
    vscode.commands.registerCommand(RUN_TASK_COMMAND, async (task?: string) => {
      const text =
        typeof task === "string"
          ? task
          : await vscode.window.showInputBox({
              title: "Blame: run a task",
              prompt: "What should Blame do in this workspace?",
              ignoreFocusOut: true,
            });
      if (text === undefined || text.trim() === "") return false;
      transcript.show(true);
      transcript.appendLine(`\n> ${text}`);
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "Blame", cancellable: true },
          async (_progress, token) => {
            const cancel = token.onCancellationRequested(() => void engine.abort());
            try {
              await engine.prompt(text);
            } finally {
              cancel.dispose();
            }
          },
        );
        return true;
      } catch (error) {
        await showError(error);
        return false;
      }
    }),
  );
  return { keys, engine };
}

/** Shuts the engine down and makes sure the child is gone (shutdown, SIGTERM, SIGKILL). */
export async function deactivate(): Promise<void> {
  const host = activeHost;
  activeHost = undefined;
  await host?.dispose();
}

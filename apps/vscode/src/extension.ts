import * as vscode from "vscode";
import { KeyStore } from "./keyStore.js";

export const OPEN_COMMAND = "blame.open";

export interface BlameExtensionApi {
  readonly keys: KeyStore;
}

/**
 * Activation registers commands only (FR-EXT-1, R-PERF-5). The chat webview and the core child
 * process arrive in Phase 4.
 */
export function activate(context: vscode.ExtensionContext): BlameExtensionApi {
  const keys = new KeyStore(context.secrets);
  context.subscriptions.push(
    vscode.commands.registerCommand(OPEN_COMMAND, () => {
      // Not awaited: the message resolves only when the user dismisses it.
      void vscode.window.showInformationMessage(
        "Blame is installed. The chat panel arrives in a later build.",
      );
      return true;
    }),
  );
  return { keys };
}

export function deactivate(): void {}

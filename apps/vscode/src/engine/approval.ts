import type { ApprovalPrompt } from "@blame-ai/core/engine-client";

/** The only button that approves. VS Code adds Cancel to every modal; Cancel or Escape denies. */
export const APPROVE = "Approve";

/** The slice of `vscode.window` this needs, so tests can fake it. */
export interface WarningWindow {
  showWarningMessage(
    message: string,
    options: { modal: true; detail?: string },
    ...items: string[]
  ): Thenable<string | undefined>;
}

/** Names the exact action: tool, files, why it paused (APP_FLOW: one approval per action). */
export function describeApproval(req: ApprovalPrompt): { message: string; detail: string } {
  const target = req.paths.length > 0 ? ` on ${req.paths.join(", ")}` : "";
  const lines = [
    req.reason,
    "",
    `Tool: ${req.toolName}`,
    `Capability: ${req.capability}`,
    ...(req.riskyClass === undefined ? [] : [`Risk: ${req.riskyClass}`]),
    "",
    "Cancel or close this dialog to deny. No answer in time also denies.",
  ];
  return { message: `Blame wants to run ${req.toolName}${target}`, detail: lines.join("\n") };
}

/**
 * Approval through a native modal, until the chat webview's approval cards land. A modal cannot be
 * closed from code, so a click after the request timed out or was cancelled is ignored (the client
 * has already answered deny).
 */
export function createModalApproval(
  window: WarningWindow,
): (req: ApprovalPrompt, signal: AbortSignal) => Promise<boolean> {
  return async (req, signal) => {
    if (signal.aborted) return false;
    const { message, detail } = describeApproval(req);
    const choice = await window.showWarningMessage(message, { modal: true, detail }, APPROVE);
    return choice === APPROVE && !signal.aborted;
  };
}

import type { ApprovalPrompt } from "@blame-ai/core/engine-client";
import { describe, expect, it, vi } from "vitest";
import { APPROVE, createModalApproval, describeApproval } from "../src/engine/approval";

const write: ApprovalPrompt = {
  id: "a1",
  toolName: "write",
  toolCallId: "t1",
  capability: "edit_workspace",
  paths: ["auth/login.ts"],
  riskyClass: "safe_zone",
  reason: "auth/ is a safe zone",
  timeoutMs: 300_000,
};

describe("approval modal", () => {
  it("names the tool, the exact files and the reason (APP_FLOW: one approval per action)", () => {
    const { message, detail } = describeApproval(write);
    expect(message).toBe("Blame wants to run write on auth/login.ts");
    expect(detail).toContain("auth/ is a safe zone");
    expect(detail).toContain("safe_zone");
    expect(detail).toContain("edit_workspace");
  });

  it("describes an action with no paths by its tool", () => {
    expect(describeApproval({ ...write, toolName: "bash", paths: [] }).message).toBe(
      "Blame wants to run bash",
    );
  });

  it("shows a modal warning and approves only on the Approve button", async () => {
    const show = vi.fn(async () => APPROVE as string | undefined);
    const ask = createModalApproval({ showWarningMessage: show });
    expect(await ask(write, new AbortController().signal)).toBe(true);
    expect(show).toHaveBeenCalledWith(
      "Blame wants to run write on auth/login.ts",
      expect.objectContaining({ modal: true }),
      APPROVE,
    );
  });

  it("denies when the dialog is dismissed", async () => {
    const ask = createModalApproval({ showWarningMessage: async () => undefined });
    expect(await ask(write, new AbortController().signal)).toBe(false);
  });

  it("denies a click that lands after the request timed out or was cancelled", async () => {
    const ctrl = new AbortController();
    const ask = createModalApproval({
      showWarningMessage: async () => {
        ctrl.abort();
        return APPROVE;
      },
    });
    expect(await ask(write, ctrl.signal)).toBe(false);
  });

  it("does not open a dialog for a request that is already cancelled", async () => {
    const show = vi.fn(async () => APPROVE as string | undefined);
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await createModalApproval({ showWarningMessage: show })(write, ctrl.signal)).toBe(false);
    expect(show).not.toHaveBeenCalled();
  });
});

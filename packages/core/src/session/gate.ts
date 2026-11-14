import { evaluate } from "../policy/policy.js";
import type {
  ActionRequest,
  Decision,
  PolicyConfig,
  PolicyContext,
  PolicyResult,
} from "../policy/types.js";
import { classifyToolCall } from "./classify.js";

export interface ToolCallInfo {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly input: Record<string, unknown>;
}

export interface ApprovalRequest extends ToolCallInfo {
  readonly action: ActionRequest;
  readonly result: PolicyResult;
}

/** Asks a human. Resolves true to run the call. A rejection counts as "no" (fail closed). */
export type Approver = (request: ApprovalRequest) => Promise<boolean>;

/**
 * One gate decision that needs a record (FR-CORE-3: asked and blocked calls), or an
 * `execution_violation`: a tool execution with no matching allow decision, which the execution
 * guard refused (guard.ts).
 */
export interface AuditEvent {
  readonly type: "tool_decision" | "execution_violation";
  /** ISO time of the decision. */
  readonly at: string;
  readonly toolName: string;
  readonly toolCallId: string;
  readonly capability: string;
  readonly paths: readonly string[];
  readonly riskyClass?: string;
  readonly decision: Decision;
  readonly reason: string;
  readonly effectiveLevelId: string;
  /** Set for "ask" decisions: whether a human approved the call. */
  readonly approved?: boolean;
}

export interface GateBlock {
  readonly block: true;
  readonly reason: string;
}

export interface AutonomyGateOptions {
  readonly policy: PolicyConfig;
  readonly cwd: string;
  /** A function is read on every call, so a preset change applies to the next call (FR-AUTO-2). */
  readonly policyContext: PolicyContext | (() => PolicyContext);
  readonly approve?: Approver;
  readonly onAudit?: (event: AuditEvent) => void;
  readonly classify?: typeof classifyToolCall;
}

/** Decides one tool call. Resolves undefined to let it run, or a block with a reason. */
export type AutonomyGate = (
  call: ToolCallInfo,
  fallbackApprover?: Approver,
) => Promise<GateBlock | undefined>;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The autonomy gate behind Pi's `tool_call` hook (ARCHITECTURE section 4, FR-CORE-3). Policy
 * decides allow, ask or block; "ask" goes to the host's approver, then to the fallback (Pi's
 * `ctx.ui.confirm` when a UI exists), and with neither it blocks. Any error blocks.
 */
export function createAutonomyGate(options: AutonomyGateOptions): AutonomyGate {
  const classify = options.classify ?? classifyToolCall;
  const contextOf =
    typeof options.policyContext === "function"
      ? options.policyContext
      : () => options.policyContext as PolicyContext;

  return async (call, fallbackApprover) => {
    let action: ActionRequest = { capability: `tool:${call.toolName}` };
    let result: PolicyResult;
    try {
      action = classify(call.toolName, call.input, options.cwd);
      result = evaluate(options.policy, contextOf(), action);
    } catch (error) {
      result = {
        decision: "block",
        reason: `Policy error: ${message(error)}`,
        effectiveLevelId: "unknown",
      };
    }

    const record = (approved?: boolean) =>
      options.onAudit?.({
        type: "tool_decision",
        at: new Date().toISOString(),
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        capability: action.capability,
        paths: action.paths ?? [],
        ...(action.riskyClass === undefined ? {} : { riskyClass: action.riskyClass }),
        decision: result.decision,
        reason: result.reason,
        effectiveLevelId: result.effectiveLevelId,
        ...(approved === undefined ? {} : { approved }),
      });

    if (result.decision === "allow") return undefined;
    if (result.decision === "block") {
      record();
      return { block: true, reason: result.reason };
    }

    const approver = options.approve ?? fallbackApprover;
    if (approver === undefined) {
      record(false);
      return { block: true, reason: `Not approved (no one to ask): ${result.reason}` };
    }
    try {
      const approved = await approver({ ...call, action, result });
      record(approved);
      return approved ? undefined : { block: true, reason: `Not approved: ${result.reason}` };
    } catch (error) {
      record(false);
      return { block: true, reason: `Approval failed (${message(error)}): ${result.reason}` };
    }
  };
}

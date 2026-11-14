import type { AnyToolDefinition } from "./search.js";

/** An execution that did not match an allow decision of the gate (defense in depth). */
export interface ExecutionViolation {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly reason: string;
}

/**
 * One-shot record of the autonomy gate's allow decisions, keyed by tool call id. The guarded tools
 * consume an entry before they run; anything without a matching entry is refused and reported.
 * This sits behind Pi's `tool_call` hook, which is the primary gate (THREAT_MODEL T-19 and section 3.1).
 */
export interface ExecutionLedger {
  /** The gate let this call run (allowed, or asked and approved). */
  allow(toolCallId: string, toolName: string, input: unknown): void;
  /** The gate saw this call and blocked it. */
  blocked(toolCallId: string): void;
  /** Throws, and reports a violation, unless an unused allow for this id, tool and input exists. */
  consume(toolCallId: string, toolName: string, input: unknown): void;
  /** From Pi's `tool_execution_end`: a successful execution the gate never saw is a violation. */
  executionEnded(toolCallId: string, toolName: string, isError: boolean): void;
}

function snapshot(input: unknown): string {
  try {
    return JSON.stringify(input) ?? "undefined";
  } catch {
    return "<unserializable>";
  }
}

export function createExecutionLedger(
  onViolation: (violation: ExecutionViolation) => void,
): ExecutionLedger {
  const allowed = new Map<string, { toolName: string; input: string }>();
  const seen = new Set<string>();
  const violate = (toolCallId: string, toolName: string, reason: string) => {
    try {
      onViolation({ toolCallId, toolName, reason });
    } catch {
      // Recording must never turn a block into a run.
    }
  };
  return {
    allow(toolCallId, toolName, input) {
      seen.add(toolCallId);
      allowed.set(toolCallId, { toolName, input: snapshot(input) });
    },
    blocked(toolCallId) {
      seen.add(toolCallId);
      allowed.delete(toolCallId);
    },
    consume(toolCallId, toolName, input) {
      const entry = allowed.get(toolCallId);
      allowed.delete(toolCallId);
      if (entry === undefined || entry.toolName !== toolName) {
        const reason = `Blame blocked ${toolName}: no matching policy decision for call ${toolCallId}`;
        violate(toolCallId, toolName, reason);
        throw new Error(reason);
      }
      if (entry.input !== snapshot(input)) {
        const reason = `Blame blocked ${toolName}: its input changed after the policy decision`;
        violate(toolCallId, toolName, reason);
        throw new Error(reason);
      }
    },
    executionEnded(toolCallId, toolName, isError) {
      const known = seen.delete(toolCallId);
      allowed.delete(toolCallId);
      if (!known && !isError) {
        violate(toolCallId, toolName, `${toolName} ran without passing Blame's policy gate`);
      }
    },
  };
}

/** The tool with a ledger check in front of `execute`. Everything else is Pi's definition. */
export function guardTool(
  definition: AnyToolDefinition,
  ledger: ExecutionLedger,
): AnyToolDefinition {
  const execute: AnyToolDefinition["execute"] = async (
    toolCallId,
    params,
    signal,
    onUpdate,
    ctx,
  ) => {
    ledger.consume(toolCallId, definition.name, params);
    return definition.execute(toolCallId, params, signal, onUpdate, ctx);
  };
  return { ...definition, execute };
}

import type {
  EngineAdapter,
  EngineEvent,
  EngineListener,
  EngineSession,
  EngineSessionOptions,
  ToolCall,
} from "./types.js";

export interface StubScript {
  /** Tool calls the stub "makes" on each prompt, in order, before replying. */
  readonly toolCalls?: readonly ToolCall[];
}

/**
 * Engine stub for Phase 0 and for tests. It echoes the prompt and sends each scripted tool call
 * through the gate, so the CLI and extension can be wired before the Pi adapter exists.
 */
export function createStubEngine(script: StubScript = {}): EngineAdapter {
  return {
    name: "stub",
    async createSession(options: EngineSessionOptions): Promise<EngineSession> {
      const listeners = new Set<EngineListener>();
      let aborted = false;
      let disposed = false;
      const emit = (event: EngineEvent) => {
        for (const listener of listeners) listener(event);
      };

      return {
        async prompt(text: string) {
          if (disposed) throw new Error("Session is disposed");
          aborted = false;
          for (const call of script.toolCalls ?? []) {
            if (aborted) break;
            emit({ type: "tool_call", call });
            emit({ type: "tool_decision", callId: call.id, result: options.gate(call) });
          }
          if (aborted) return;
          emit({ type: "message_delta", text: `stub: ${text}` });
          emit({ type: "turn_end" });
        },
        async abort() {
          aborted = true;
          emit({ type: "aborted" });
        },
        subscribe(listener: EngineListener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async dispose() {
          disposed = true;
          listeners.clear();
        },
      };
    },
  };
}

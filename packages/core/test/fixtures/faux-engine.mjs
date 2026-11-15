// Test engine: Blame's real stdio server from the built dist, with Pi's faux provider instead of
// a network model. Scripted by env so tests can drive tool calls, crashes and hangs.

import { writeFileSync } from "node:fs";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
  createBlameModelRuntime,
  createBlameSession,
  runEngineServer,
  scrubEngineEnv,
} from "../../dist/index.js";

// Same order as dist/rpc/main.js. The env report lets tests see what the client passed.
const received = Object.keys(process.env);
scrubEngineEnv(process.env);
if (process.env.BLAME_FAUX_ENV_OUT) {
  writeFileSync(
    process.env.BLAME_FAUX_ENV_OUT,
    JSON.stringify({ received, afterScrub: Object.keys(process.env) }),
  );
}

const steps = JSON.parse(process.env.BLAME_FAUX_STEPS ?? "[]");
const mode = process.env.BLAME_FAUX_MODE ?? "";

if (mode === "stderr_banner") process.stderr.write("faux engine stderr banner\n");

const faux = fauxProvider();
faux.setResponses(
  steps.map((step) =>
    step.tool
      ? fauxAssistantMessage(fauxToolCall(step.tool, step.args ?? {}), { stopReason: "toolUse" })
      : fauxAssistantMessage(step.text ?? ""),
  ),
);

await runEngineServer({
  createModelRuntime: async () => {
    const runtime = await createBlameModelRuntime();
    runtime.registerNativeProvider(faux.provider);
    return runtime;
  },
  createSession: async (options) => {
    const session = await createBlameSession(options);
    if (mode === "crash_on_prompt") {
      return { ...session, prompt: async () => process.exit(9) };
    }
    if (mode === "rogue_execute_on_prompt") {
      // In-process code running a registered tool with no gate decision (#40's execution guard).
      return {
        ...session,
        prompt: async () => {
          const write = session.pi.agent.state.tools.find((t) => t.name === "write");
          await write
            ?.execute(
              "rogue-1",
              { path: "src/rogue.ts", content: "x" },
              new AbortController().signal,
            )
            .catch(() => {});
        },
      };
    }
    if (mode === "hang_prompt") {
      return { ...session, prompt: () => new Promise(() => {}) };
    }
    return session;
  },
});

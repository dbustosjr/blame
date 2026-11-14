import { homedir } from "node:os";
import { join } from "node:path";
import { type CredentialStore, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  createAgentSession,
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  DefaultResourceLoader,
  type ExtensionFactory,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { applyBlameAuthPolicy, policyCredentialStore } from "../auth/policy.js";
import { type KeyStore, keyStoreCredentials } from "../keys/keystore.js";
import { defaultPolicy } from "../policy/seed.js";
import type { PolicyConfig, PolicyContext } from "../policy/types.js";
import { type Approver, type AuditEvent, createAutonomyGate } from "./gate.js";
import { createExecutionLedger, guardTool } from "./guard.js";
import { type AnyToolDefinition, createSecretSafeSearchTools } from "./search.js";
import { testOnlyExtraExtensionFactories } from "./test-hooks.js";

/** Appended to Pi's system prompt in every Blame session. */
export const BLAME_SYSTEM_PROMPT = [
  "You are Blame, a vendor-neutral coding agent that owns its mistakes.",
  "Work in small, verifiable steps. Reproduce a bug with a failing test before you fix it.",
  "Some tool calls need a human's approval. When one is blocked, say why and continue without it.",
  "Tell the user plainly what you changed, what you could not verify, and what went wrong.",
].join("\n");

/** Custom message type for injected context (lessons, knowledge items). */
export const BLAME_CONTEXT_MESSAGE_TYPE = "blame-context";

/** Pi's UI approval dialogs dismiss after this long, and a dismissed dialog means deny. */
export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Pi's built-in tools Blame turns on by default. The gate classifies each of them. grep, find and
 * ls are off by default; a host can add them through `tools`, and they are always Blame's
 * secret-safe versions.
 */
export const BLAME_TOOLS = ["read", "bash", "edit", "write"] as const;

export interface BlameModelSelection {
  /** Pi provider id, for example "openai" or "anthropic". */
  readonly providerId: string;
  readonly modelId: string;
}

export interface BlameModelRuntimeOptions {
  /** Persistent keys. Without it, keys live in memory only. */
  readonly keys?: KeyStore;
  /** Advanced: a ready Pi CredentialStore. Wins over `keys`. */
  readonly credentials?: CredentialStore;
}

/**
 * A Pi `ModelRuntime` that never touches `~/.pi`: credentials come from Blame (KeyStore or
 * memory) instead of Pi's `auth.json`, models come from Pi's built-in catalog with no
 * `models.json`, and there is no network catalog refresh at startup. Blame's auth policy is
 * applied: Claude subscription OAuth and other non-allowlisted logins are removed (auth/policy.ts).
 */
export async function createBlameModelRuntime(
  options: BlameModelRuntimeOptions = {},
): Promise<ModelRuntime> {
  const credentials =
    options.credentials ??
    (options.keys ? keyStoreCredentials(options.keys) : new InMemoryCredentialStore());
  const runtime = await ModelRuntime.create({
    credentials: policyCredentialStore(credentials),
    modelsPath: null,
    refreshOnCreate: false,
  });
  applyBlameAuthPolicy(runtime);
  return runtime;
}

export interface BlameSessionOptions {
  /** Workspace the agent works in. */
  readonly cwd: string;
  /** BYOK model choice. */
  readonly model: BlameModelSelection;
  /** BYOK key for `model.providerId`, held in memory for this session only. */
  readonly apiKey?: string;
  /** Persistent key store (keychain on the CLI). Ignored when `modelRuntime` is given. */
  readonly keys?: KeyStore;
  /** Blame's config dir. Default `~/.blame`. Pi's agent dir becomes `<configDir>/agent`. */
  readonly configDir?: string;
  /** Trust levels, presets and safe zones. Default: the seed policy. */
  readonly policy?: PolicyConfig;
  /** Read on every tool call when it is a function, so preset changes apply without restart. */
  readonly policyContext: PolicyContext | (() => PolicyContext);
  /** Host approval for "ask" decisions. Without it, Pi's UI confirm is used when a UI exists. */
  readonly approve?: Approver;
  readonly onAudit?: (event: AuditEvent) => void;
  /** Context for a prompt (lessons, knowledge). Injected as one labeled custom message. */
  readonly getContext?: (prompt: string) => Promise<string | undefined> | string | undefined;
  /** Extra system prompt text after Blame's own. */
  readonly systemPrompt?: { readonly append?: readonly string[] };
  /** Advanced and tests: a prepared model runtime (for example with Pi's faux provider). */
  readonly modelRuntime?: ModelRuntime;
  /** Tool names to turn on. Default: BLAME_TOOLS. */
  readonly tools?: readonly string[];
}

export interface BlameSession {
  /** The underlying Pi session, for streaming events. Only packages/core sees this type. */
  readonly pi: AgentSession;
  readonly modelRuntime: ModelRuntime;
  /** Asked and blocked tool calls for this session, oldest first. */
  readonly auditLog: readonly AuditEvent[];
  /** Errors from loading Blame's inline extensions. Empty when healthy. */
  readonly extensionErrors: readonly { readonly path: string; readonly error: string }[];
  prompt(text: string): Promise<void>;
  dispose(): void;
}

/**
 * Starts a Blame session on Pi's SDK (FR-CORE-1, ARCHITECTURE section 4): Pi's
 * `createAgentSession()` with in-memory settings and session storage, Blame's inline extensions
 * (autonomy gate on `tool_call`, context injection on `before_agent_start`), and no discovery of
 * the user's Pi extensions, skills, prompt templates or themes.
 */
export async function createBlameSession(options: BlameSessionOptions): Promise<BlameSession> {
  const modelRuntime =
    options.modelRuntime ??
    (await createBlameModelRuntime(options.keys ? { keys: options.keys } : {}));
  // A host-supplied runtime gets the same auth policy (idempotent for Blame's own).
  applyBlameAuthPolicy(modelRuntime);
  const { providerId, modelId } = options.model;
  if (options.apiKey !== undefined) await modelRuntime.setRuntimeApiKey(providerId, options.apiKey);
  const model = modelRuntime.getModel(providerId, modelId);
  if (!model) throw new Error(`Unknown model ${providerId}/${modelId}`);

  const configDir = options.configDir ?? join(homedir(), ".blame");
  const agentDir = join(configDir, "agent");
  const auditLog: AuditEvent[] = [];
  const gate = createAutonomyGate({
    policy: options.policy ?? defaultPolicy,
    cwd: options.cwd,
    policyContext: options.policyContext,
    ...(options.approve ? { approve: options.approve } : {}),
    onAudit: (event) => {
      auditLog.push(event);
      options.onAudit?.(event);
    },
  });

  const recordViolation = (violation: { toolName: string; toolCallId: string; reason: string }) => {
    const event: AuditEvent = {
      type: "execution_violation",
      at: new Date().toISOString(),
      toolName: violation.toolName,
      toolCallId: violation.toolCallId,
      capability: `tool:${violation.toolName}`,
      paths: [],
      decision: "block",
      reason: violation.reason,
      effectiveLevelId: "none",
    };
    auditLog.push(event);
    options.onAudit?.(event);
  };
  // Defense in depth behind the tool_call hook: every tool's execute checks for this call's allow.
  const ledger = createExecutionLedger(recordViolation);

  const toolNames = [...(options.tools ?? BLAME_TOOLS)];
  const settingsManager = SettingsManager.inMemory();
  // Same options Pi's AgentSession passes its own built-ins (agent-session.js `_buildRuntime`).
  const shellPath = settingsManager.getShellPath();
  const commandPrefix = settingsManager.getShellCommandPrefix();
  const builtins: Record<string, () => AnyToolDefinition> = {
    read: () =>
      createReadToolDefinition(options.cwd, {
        autoResizeImages: settingsManager.getImageAutoResize(),
      }),
    bash: () =>
      createBashToolDefinition(options.cwd, {
        ...(shellPath === undefined ? {} : { shellPath }),
        ...(commandPrefix === undefined ? {} : { commandPrefix }),
      }),
    edit: () => createEditToolDefinition(options.cwd),
    write: () => createWriteToolDefinition(options.cwd),
  };
  const searchTools = new Map(createSecretSafeSearchTools(options.cwd).map((t) => [t.name, t]));
  const guardedTools = toolNames.map((name) => {
    const definition = Object.hasOwn(builtins, name) ? builtins[name]?.() : searchTools.get(name);
    if (definition === undefined) {
      throw new Error(`Blame cannot guard tool "${name}", so it will not turn it on`);
    }
    return guardTool(definition, ledger);
  });
  const guardedToolsExtension: ExtensionFactory = (pi) => {
    for (const tool of guardedTools) pi.registerTool(tool);
  };

  const autonomyGate: ExtensionFactory = (pi) => {
    pi.on("tool_call", async (event, ctx) => {
      const fallback: Approver | undefined = ctx.hasUI
        ? (request) =>
            ctx.ui.confirm(
              "Blame needs your approval",
              `${request.toolName}: ${request.result.reason}`,
              { timeout: APPROVAL_TIMEOUT_MS },
            )
        : undefined;
      let decision: Awaited<ReturnType<typeof gate>>;
      try {
        decision = await gate(
          { toolName: event.toolName, toolCallId: event.toolCallId, input: event.input },
          fallback,
        );
      } catch (error) {
        decision = { block: true, reason: `Gate error: ${String(error)}` };
      }
      if (decision === undefined) ledger.allow(event.toolCallId, event.toolName, event.input);
      else ledger.blocked(event.toolCallId);
      return decision;
    });
  };

  const getContext = options.getContext;
  const contextInject: ExtensionFactory = (pi) => {
    pi.on("before_agent_start", async (event) => {
      if (event.messageType !== "user" || getContext === undefined) return undefined;
      let text: string | undefined;
      try {
        text = await getContext(event.prompt);
      } catch {
        // FR-CORE-2: the run continues without context.
        text = undefined;
      }
      if (!text) return undefined;
      return { message: { customType: BLAME_CONTEXT_MESSAGE_TYPE, content: text, display: true } };
    });
  };

  const resourceLoader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [
      { name: "blame-guarded-tools", factory: guardedToolsExtension },
      { name: "blame-autonomy-gate", factory: autonomyGate },
      { name: "blame-context-inject", factory: contextInject },
      // Empty outside tests (test-hooks.ts).
      ...testOnlyExtraExtensionFactories(options).map((factory, i) => ({
        name: `blame-test-only-${i}`,
        factory,
      })),
    ],
    appendSystemPromptOverride: () => [
      BLAME_SYSTEM_PROMPT,
      ...(options.systemPrompt?.append ?? []),
    ],
  });
  await resourceLoader.reload();

  const { session, extensionsResult } = await createAgentSession({
    cwd: options.cwd,
    agentDir,
    model,
    modelRuntime,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(options.cwd),
    tools: toolNames,
  });

  // If a Blame extension failed to load, the gate or the guarded tools may be missing, and Pi
  // runs tools without a tool_call hook at all. Fail closed.
  if (extensionsResult.errors.length > 0) {
    session.dispose();
    throw new Error(
      `Blame extensions failed to load: ${extensionsResult.errors.map((e) => e.error).join("; ")}`,
    );
  }
  session.subscribe((event) => {
    if (event.type === "tool_execution_end") {
      ledger.executionEnded(event.toolCallId, event.toolName, event.isError);
    }
  });

  return {
    pi: session,
    modelRuntime,
    auditLog,
    extensionErrors: extensionsResult.errors,
    prompt: async (text) => {
      await session.prompt(text);
    },
    dispose: () => session.dispose(),
  };
}

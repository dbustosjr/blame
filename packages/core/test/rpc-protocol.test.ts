import { describe, expect, it } from "vitest";
import { BLAME_PROTOCOL_VERSION, parseClientMessage, parseEngineMessage } from "../src/index.js";

const v = BLAME_PROTOCOL_VERSION;
const policyContext = {
  presetId: "guided",
  earnedLevelId: "L2",
  optedIn: false,
  sandboxAvailable: false,
};

describe("parseClientMessage", () => {
  it("accepts a valid init request", () => {
    const line = JSON.stringify({
      v,
      type: "request",
      id: "1",
      method: "init",
      params: { cwd: "/w", model: { providerId: "openai", modelId: "gpt" }, policyContext },
    });
    const parsed = parseClientMessage(line);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.message).toMatchObject({ method: "init", id: "1" });
  });

  it("accepts prompt, abort, blame_state, shutdown and approval_response", () => {
    for (const msg of [
      { v, type: "request", id: "2", method: "prompt", params: { text: "hi" } },
      { v, type: "request", id: "3", method: "abort" },
      { v, type: "request", id: "4", method: "blame_state" },
      { v, type: "request", id: "5", method: "shutdown" },
      { v, type: "approval_response", id: "a1", approved: false },
    ]) {
      expect(parseClientMessage(JSON.stringify(msg))).toMatchObject({ ok: true });
    }
  });

  it.each([
    ["malformed JSON", "{not json", "parse_error"],
    ["a non-object", "[1,2]", "invalid_message"],
    [
      "a wrong version",
      JSON.stringify({ v: 99, type: "request", id: "1", method: "abort" }),
      "unsupported_version",
    ],
    [
      "a missing version",
      JSON.stringify({ type: "request", id: "1", method: "abort" }),
      "unsupported_version",
    ],
    ["an unknown type", JSON.stringify({ v, type: "bash", id: "1" }), "invalid_message"],
    [
      "an unknown method",
      JSON.stringify({ v, type: "request", id: "1", method: "bash", params: {} }),
      "unknown_method",
    ],
    [
      "an empty id",
      JSON.stringify({ v, type: "request", id: "", method: "abort" }),
      "invalid_message",
    ],
    [
      "prompt without text",
      JSON.stringify({ v, type: "request", id: "1", method: "prompt", params: {} }),
      "invalid_params",
    ],
    [
      "approval with a string approved",
      JSON.stringify({ v, type: "approval_response", id: "a", approved: "yes" }),
      "invalid_message",
    ],
    [
      "init without policyContext",
      JSON.stringify({
        v,
        type: "request",
        id: "1",
        method: "init",
        params: { cwd: "/w", model: { providerId: "a", modelId: "b" } },
      }),
      "invalid_params",
    ],
    [
      "init with a non-string apiKey",
      JSON.stringify({
        v,
        type: "request",
        id: "1",
        method: "init",
        params: { cwd: "/w", model: { providerId: "a", modelId: "b" }, policyContext, apiKey: 5 },
      }),
      "invalid_params",
    ],
    [
      "init with a bad timeout",
      JSON.stringify({
        v,
        type: "request",
        id: "1",
        method: "init",
        params: {
          cwd: "/w",
          model: { providerId: "a", modelId: "b" },
          policyContext,
          approvalTimeoutMs: -1,
        },
      }),
      "invalid_params",
    ],
  ])("rejects %s", (_name, line, code) => {
    const parsed = parseClientMessage(line);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe(code);
  });

  it("keeps the request id on a params error so the engine can answer it", () => {
    const parsed = parseClientMessage(
      JSON.stringify({ v, type: "request", id: "7", method: "prompt", params: { text: 1 } }),
    );
    expect(parsed).toMatchObject({ ok: false, id: "7" });
  });

  it("never echoes an apiKey in an error message", () => {
    const parsed = parseClientMessage(
      JSON.stringify({
        v,
        type: "request",
        id: "1",
        method: "init",
        params: { apiKey: "sk-secret-123" },
      }),
    );
    expect(parsed.ok).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain("sk-secret-123");
  });
});

describe("parseEngineMessage", () => {
  it("accepts ready, responses, events, approval requests and protocol errors", () => {
    for (const msg of [
      { v, type: "ready", protocol: v, engine: "blame" },
      { v, type: "response", id: "1", ok: true },
      { v, type: "response", id: "1", ok: true, result: { x: 1 } },
      { v, type: "response", id: "1", ok: false, error: { code: "busy", message: "m" } },
      { v, type: "event", event: { type: "text_delta", text: "hi" } },
      { v, type: "event", event: { type: "settled" } },
      {
        v,
        type: "approval_request",
        id: "a1",
        toolName: "write",
        toolCallId: "c1",
        capability: "write",
        paths: ["auth/x.ts"],
        reason: "Safe zone",
        timeoutMs: 1000,
      },
      { v, type: "protocol_error", code: "parse_error", message: "m" },
    ]) {
      expect(parseEngineMessage(JSON.stringify(msg))).toMatchObject({ ok: true });
    }
  });

  it.each([
    ["a response without ok", { v, type: "response", id: "1" }],
    ["a failed response without error", { v, type: "response", id: "1", ok: false }],
    ["an event without a type", { v, type: "event", event: {} }],
    ["an unknown event", { v, type: "event", event: { type: "rm_rf" } }],
    [
      "an approval request without paths",
      {
        v,
        type: "approval_request",
        id: "a",
        toolName: "w",
        toolCallId: "c",
        capability: "w",
        reason: "r",
        timeoutMs: 1,
      },
    ],
    ["a wrong version", { v: 2, type: "ready", protocol: 2, engine: "blame" }],
  ])("rejects %s", (_name, msg) => {
    expect(parseEngineMessage(JSON.stringify(msg)).ok).toBe(false);
  });

  it("accepts both audit event types from #40 and rejects an unknown one", () => {
    const audit = (type: string) =>
      JSON.stringify({
        v,
        type: "event",
        event: {
          type: "audit",
          audit: {
            type,
            at: "2026-11-14T00:00:00.000Z",
            toolName: "write",
            toolCallId: "c1",
            capability: "tool:write",
            paths: [],
            decision: "block",
            reason: "no matching policy decision",
            effectiveLevelId: "none",
          },
        },
      });
    expect(parseEngineMessage(audit("tool_decision")).ok).toBe(true);
    expect(parseEngineMessage(audit("execution_violation")).ok).toBe(true);
    expect(parseEngineMessage(audit("tool_run")).ok).toBe(false);
  });
});

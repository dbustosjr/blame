import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Credential, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  ALLOWED_OAUTH_PROVIDERS,
  applyBlameAuthPolicy,
  BlameAuthPolicyError,
  blameAuthMethods,
  blameLogin,
  createBlameModelRuntime,
  createBlameSession,
  isAuthMethodAllowed,
  policyCredentialStore,
} from "../src/index.js";

const fakeOAuth = (): Credential => ({
  type: "oauth",
  access: "fake-access",
  refresh: "fake-refresh",
  expires: Date.now() + 60 * 60 * 1000,
});

const interaction = {
  prompt: async () => "",
  notify: () => {},
} as unknown as Parameters<typeof blameLogin>[3];

async function rawPiRuntime(credentials = new InMemoryCredentialStore()) {
  return ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
}

describe("Blame auth policy (PRD DEC-2, R-BYOK-2)", () => {
  it("guards the premise: Pi 1.5.2 itself ships a Claude subscription OAuth login", async () => {
    // If Pi drops this, the removal below is moot; update the tests rather than deleting them.
    const pi = await rawPiRuntime();
    const anthropic = pi.getProvider("anthropic");
    expect(anthropic?.auth.oauth?.isSubscription).toBe(true);
    expect(anthropic?.auth.oauth?.name).toMatch(/Claude/);
  });

  it("allows API keys everywhere and OAuth only for ChatGPT sign-in", () => {
    expect([...ALLOWED_OAUTH_PROVIDERS].sort()).toEqual(["openai", "openai-codex"]);
    expect(isAuthMethodAllowed("anthropic", "api_key")).toBe(true);
    expect(isAuthMethodAllowed("anthropic", "oauth")).toBe(false);
    expect(isAuthMethodAllowed("openai", "oauth")).toBe(true);
    expect(isAuthMethodAllowed("openai-codex", "oauth")).toBe(true);
    for (const id of [
      "github-copilot",
      "kimi-coding",
      "meta",
      "xai",
      "openrouter",
      "radius",
      "new-provider",
    ]) {
      expect(isAuthMethodAllowed(id, "oauth")).toBe(false);
    }
  });

  it("Claude subscription OAuth stays removed from Blame's model runtime", async () => {
    const runtime = await createBlameModelRuntime();
    const anthropic = runtime.getProvider("anthropic");
    expect(anthropic).toBeDefined();
    expect(anthropic?.auth.oauth).toBeUndefined();
    expect(anthropic?.auth.apiKey).toBeDefined();
    expect(runtime.getModels("anthropic").length).toBeGreaterThan(0);
    await runtime.refresh({ allowNetwork: false });
    expect(runtime.getProvider("anthropic")?.auth.oauth).toBeUndefined();
  });

  it("removes every OAuth method that is not on the allowlist, and keeps ChatGPT sign-in", async () => {
    const runtime = await createBlameModelRuntime();
    for (const provider of runtime.getProviders()) {
      if (provider.auth.oauth) expect(ALLOWED_OAUTH_PROVIDERS).toContain(provider.id);
    }
    expect(runtime.getProvider("openai")?.auth.oauth?.loginLabel).toBe("Sign in with ChatGPT");
    expect(runtime.getProvider("openai-codex")?.auth.oauth).toBeDefined();
  });

  it("Pi's own login path refuses Anthropic OAuth after the policy is applied", async () => {
    const runtime = await createBlameModelRuntime();
    await expect(runtime.login("anthropic", "oauth", interaction)).rejects.toThrow(
      /does not support oauth/i,
    );
  });

  it("blameLogin refuses a blocked method before any flow runs", async () => {
    const runtime = await createBlameModelRuntime();
    const login = vi.spyOn(runtime, "login");
    await expect(blameLogin(runtime, "anthropic", "oauth", interaction)).rejects.toBeInstanceOf(
      BlameAuthPolicyError,
    );
    await expect(blameLogin(runtime, "github-copilot", "oauth", interaction)).rejects.toThrow(
      /not allowed/,
    );
    expect(login).not.toHaveBeenCalled();
  });

  it("blameLogin passes ChatGPT sign-in through to Pi", async () => {
    const runtime = await createBlameModelRuntime();
    const credential = fakeOAuth();
    const login = vi.spyOn(runtime, "login").mockResolvedValue(credential);
    await expect(blameLogin(runtime, "openai-codex", "oauth", interaction)).resolves.toBe(
      credential,
    );
    expect(login).toHaveBeenCalledWith("openai-codex", "oauth", interaction, undefined);
  });

  it("lists only allowed auth methods for a host's sign-in picker", async () => {
    const runtime = await createBlameModelRuntime();
    const methods = blameAuthMethods(runtime);
    expect(methods).toContainEqual(
      expect.objectContaining({ providerId: "anthropic", type: "api_key" }),
    );
    expect(methods).not.toContainEqual(
      expect.objectContaining({ providerId: "anthropic", type: "oauth" }),
    );
    expect(methods).toContainEqual({
      providerId: "openai",
      type: "oauth",
      label: "Sign in with ChatGPT",
    });
    expect(
      methods
        .filter((m) => m.type === "oauth")
        .map((m) => m.providerId)
        .sort(),
    ).toEqual(["openai", "openai-codex"]);
  });

  it("ignores a stored Anthropic OAuth credential and refuses to store one", async () => {
    const inner = new InMemoryCredentialStore();
    await inner.modify("anthropic", async () => fakeOAuth());
    const store = policyCredentialStore(inner);
    expect(await store.read("anthropic")).toBeUndefined();
    expect((await store.list()).map((c) => c.providerId)).not.toContain("anthropic");
    await expect(store.modify("anthropic", async () => fakeOAuth())).rejects.toBeInstanceOf(
      BlameAuthPolicyError,
    );
    await store.modify("anthropic", async () => ({ type: "api_key", key: "fake-test-value" }));
    expect(await store.read("anthropic")).toEqual({ type: "api_key", key: "fake-test-value" });
  });

  it("a runtime over a store that already holds Claude OAuth never uses it", async () => {
    const inner = new InMemoryCredentialStore();
    await inner.modify("anthropic", async () => fakeOAuth());
    const runtime = await createBlameModelRuntime({ credentials: inner });
    await runtime.refresh({ allowNetwork: false });
    expect(runtime.isUsingOAuth("anthropic")).toBe(false);
    expect(await runtime.getAuth("anthropic")).toBeUndefined();
  });

  it("keeps a stored ChatGPT OAuth credential readable", async () => {
    const inner = new InMemoryCredentialStore();
    const credential = fakeOAuth();
    await inner.modify("openai-codex", async () => credential);
    expect(await policyCredentialStore(inner).read("openai-codex")).toEqual(credential);
  });

  it("applyBlameAuthPolicy is idempotent and reports what it removed", async () => {
    const pi = await rawPiRuntime();
    const removed = applyBlameAuthPolicy(pi);
    expect(removed).toContain("anthropic");
    expect(removed).not.toContain("openai");
    expect(applyBlameAuthPolicy(pi)).toEqual([]);
  });

  it("createBlameSession applies the policy to a host-supplied runtime too", async () => {
    const { fauxProvider } = await import("@earendil-works/pi-ai");
    const faux = fauxProvider();
    const pi = await rawPiRuntime();
    pi.registerNativeProvider(faux.provider);
    const workDir = mkdtempSync(join(tmpdir(), "blame-auth-work-"));
    const configDir = mkdtempSync(join(tmpdir(), "blame-auth-config-"));
    const session = await createBlameSession({
      cwd: workDir,
      configDir,
      model: { providerId: "faux", modelId: "faux-1" },
      policyContext: {
        presetId: "guided",
        earnedLevelId: "L2",
        optedIn: false,
        sandboxAvailable: false,
      },
      modelRuntime: pi,
    });
    try {
      expect(pi.getProvider("anthropic")?.auth.oauth).toBeUndefined();
    } finally {
      session.dispose();
      rmSync(workDir, { recursive: true, force: true });
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("a host-supplied runtime whose store holds a Claude OAuth token never uses it in a session", async () => {
    const { fauxProvider } = await import("@earendil-works/pi-ai");
    const store = new InMemoryCredentialStore();
    await store.modify("anthropic", async () => fakeOAuth());
    const pi = await rawPiRuntime(store);
    // Premise: before Blame touches it, Pi would use the stored subscription token.
    await pi.refresh({ allowNetwork: false });
    expect(pi.isUsingOAuth("anthropic")).toBe(true);

    pi.registerNativeProvider(fauxProvider().provider);
    const workDir = mkdtempSync(join(tmpdir(), "blame-auth-work-"));
    const configDir = mkdtempSync(join(tmpdir(), "blame-auth-config-"));
    const session = await createBlameSession({
      cwd: workDir,
      configDir,
      model: { providerId: "faux", modelId: "faux-1" },
      policyContext: {
        presetId: "guided",
        earnedLevelId: "L2",
        optedIn: false,
        sandboxAvailable: false,
      },
      modelRuntime: pi,
    });
    try {
      await pi.refresh({ allowNetwork: false });
      expect(pi.isUsingOAuth("anthropic")).toBe(false);
      expect(String(JSON.stringify(await pi.getAuth("anthropic")))).not.toContain("fake-access");
    } finally {
      session.dispose();
      rmSync(workDir, { recursive: true, force: true });
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});

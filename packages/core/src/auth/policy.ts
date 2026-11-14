import type {
  AuthInteraction,
  AuthType,
  Credential,
  CredentialStore,
  LoginOptions,
  Provider,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

/**
 * Which provider auth methods Blame offers (PRD DEC-2, DEC-8, R-BYOK-2). API keys work for every
 * provider. OAuth is an allowlist, deny by default:
 *
 * - Allowed: ChatGPT sign-in, so OpenAI Plus, Pro and Business users can spend their Codex
 *   allowance through Pi (`openai` "Sign in with ChatGPT" and `openai-codex`).
 * - Removed: Anthropic's Claude Pro/Max subscription login. Claude is API key only in Blame.
 * - Removed until David decides: every other OAuth login Pi 1.5.2 ships (GitHub Copilot, Kimi,
 *   Meta, xAI, OpenRouter, Radius) and any a later Pi adds.
 *
 * Pi registers these logins on its built-in providers (`provider.auth.oauth`). Blame does not fork
 * Pi; it re-registers each affected provider as a native provider that keeps everything except the
 * OAuth method, and it filters credentials at the store.
 */
export const ALLOWED_OAUTH_PROVIDERS: readonly string[] = Object.freeze(["openai", "openai-codex"]);

/** Why a removed OAuth login is removed, for UI copy and errors. */
export const REMOVED_OAUTH_REASONS: Readonly<Record<string, string>> = Object.freeze({
  anthropic:
    "Blame never uses Claude.ai logins or subscriptions; use an Anthropic API key (PRD DEC-2)",
});

export type BlameAuthType = AuthType;

export interface BlameAuthMethod {
  readonly providerId: string;
  readonly type: BlameAuthType;
  /** Picker label from Pi, for example "Sign in with ChatGPT" or "Anthropic API key". */
  readonly label: string;
}

export class BlameAuthPolicyError extends Error {
  constructor(
    readonly providerId: string,
    readonly type: BlameAuthType,
  ) {
    super(
      `${type === "oauth" ? "OAuth sign-in" : "This sign-in"} for ${providerId} is not allowed in Blame: ${
        REMOVED_OAUTH_REASONS[providerId] ?? "only API keys and ChatGPT sign-in are supported"
      }`,
    );
    this.name = "BlameAuthPolicyError";
  }
}

export function isAuthMethodAllowed(providerId: string, type: BlameAuthType): boolean {
  if (type === "api_key") return true;
  return type === "oauth" && ALLOWED_OAUTH_PROVIDERS.includes(providerId);
}

const POLICY_APPLIED = Symbol("blame.authPolicyApplied");

/** The provider with its OAuth method hidden. A Proxy keeps Pi's class methods and `this` intact. */
function withoutOAuth(provider: Provider): Provider {
  const auth = provider.auth.apiKey
    ? { apiKey: provider.auth.apiKey }
    : // Pi requires one method; an OAuth-only provider becomes "never configured".
      { apiKey: { name: "Not available in Blame", resolve: async () => undefined } };
  return new Proxy(provider, {
    get(target, property, receiver) {
      if (property === "auth") return auth;
      if (property === POLICY_APPLIED) return true;
      return Reflect.get(target, property, receiver);
    },
  });
}

/**
 * Removes every OAuth login not on the allowlist from `runtime`. Returns the provider ids it
 * changed. Idempotent. Call it on any runtime Blame uses, including one a host or test supplies.
 */
export function applyBlameAuthPolicy(runtime: ModelRuntime): string[] {
  const removed: string[] = [];
  for (const provider of runtime.getProviders()) {
    if (!provider.auth.oauth || isAuthMethodAllowed(provider.id, "oauth")) continue;
    if ((provider as unknown as Record<symbol, unknown>)[POLICY_APPLIED] === true) continue;
    runtime.registerNativeProvider(withoutOAuth(provider));
    removed.push(provider.id);
  }
  return removed;
}

/** Auth methods a host may offer, after the policy. */
export function blameAuthMethods(runtime: ModelRuntime): BlameAuthMethod[] {
  const methods: BlameAuthMethod[] = [];
  for (const provider of runtime.getProviders()) {
    const { apiKey, oauth } = provider.auth;
    if (apiKey) methods.push({ providerId: provider.id, type: "api_key", label: apiKey.name });
    if (oauth && isAuthMethodAllowed(provider.id, "oauth")) {
      methods.push({
        providerId: provider.id,
        type: "oauth",
        label: oauth.loginLabel ?? oauth.name,
      });
    }
  }
  return methods;
}

/** Pi's `ModelRuntime.login`, refused up front for a method the policy does not allow. */
export async function blameLogin(
  runtime: ModelRuntime,
  providerId: string,
  type: BlameAuthType,
  interaction: AuthInteraction,
  options?: LoginOptions,
): Promise<Credential> {
  if (!isAuthMethodAllowed(providerId, type)) throw new BlameAuthPolicyError(providerId, type);
  return runtime.login(providerId, type, interaction, options);
}

const allowedCredential = (providerId: string, credential: Credential | undefined) =>
  credential === undefined || isAuthMethodAllowed(providerId, credential.type);

/**
 * A CredentialStore that hides disallowed credentials (for example a Claude OAuth token left by
 * another tool in a shared store) and refuses to write them.
 */
export function policyCredentialStore(inner: CredentialStore): CredentialStore {
  return {
    async read(providerId, options) {
      const credential = await inner.read(providerId, options);
      return allowedCredential(providerId, credential) ? credential : undefined;
    },
    async list(options) {
      return (await inner.list(options)).filter((info) =>
        isAuthMethodAllowed(info.providerId, info.type),
      );
    },
    modify(providerId, fn, options) {
      return inner.modify(
        providerId,
        async (current) => {
          const next = await fn(allowedCredential(providerId, current) ? current : undefined);
          if (next !== undefined && !allowedCredential(providerId, next)) {
            throw new BlameAuthPolicyError(providerId, next.type);
          }
          return next;
        },
        options,
      );
    },
    delete(providerId, options) {
      return inner.delete(providerId, options);
    },
  };
}

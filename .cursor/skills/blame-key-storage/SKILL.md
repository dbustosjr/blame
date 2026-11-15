---
name: blame-key-storage
description: Storing BYOK API keys and OAuth tokens safely in Blame on Windows, macOS and Linux. Use when writing or reviewing key or token storage, the CredentialStore that feeds Pi, the CLI keychain code (@napi-rs/keyring), the extension's SecretStorage use, revoke, or the Linux no-keyring fallback (FR-KEY-1 to FR-KEY-6, R-BYOK-4, THREAT_MODEL T-02).
---

# API keys in the OS keychain

Keys are the most sensitive thing Blame touches. The rules are fixed in AGENTS.md, TRD 4.5, ARCHITECTURE section 10 and THREAT_MODEL T-02. This skill says how to meet them on each platform. Any change here is in the "ask David first" list.

## Where keys live

| Surface | Store | Backing store |
|---|---|---|
| VS Code extension | `context.secrets` (VS Code `SecretStorage`) | VS Code encrypts with Electron `safeStorage`, which uses the OS keychain |
| CLI (`blame`) | `@napi-rs/keyring` | Windows Credential Manager, macOS Keychain, Linux Secret Service |
| Core child process (extension path) | Memory only | Keys arrive over the RPC pipe at session start |
| Pi | Blame's `CredentialStore` implementation | Pi never writes `auth.json` for Blame (FR-KEY-2) |

Never: settings JSON, `globalState` or `workspaceState`, `.env` files, Pi's `auth.json`, the learning record, logs, telemetry, argv, environment variables you set for a child, crash reports, PR text or test fixtures with real values.

`keytar` is not an option. Its repo `atom/node-keytar` is archived (read-only since December 2022), as TRD section 2 already records.

## Extension: SecretStorage

The existing `apps/vscode/src/keyStore.ts` is the pattern: one secret per provider, named `blame.apiKey.<provider>`, provider id validated against `^[a-z0-9][a-z0-9-]{0,63}$`, value trimmed and rejected when empty. The 1.105 API has `get`, `store`, `delete`, `keys()` and `onDidChange`.

- Use `onDidChange` to react when another window changes a key, for example to restart the core child with the new key.
- Revoke (FR-KEY-6) deletes every `blame.*` secret. Use `keys()` to find them and report each deletion honestly.
- On Linux, VS Code needs a Secret Service keyring. If none is found it may fall back to a weaker store; VS Code documents the `password-store` runtime argument for choosing a backend. Point users to that page from Blame's troubleshooting text instead of inventing a workaround.
- Unit tests pass a fake that implements `Pick<SecretStorage, "get" | "store" | "delete">` (see `apps/vscode/test/keyStore.test.ts`). The integration test in `src/test/suite/extension.test.ts` round-trips a fake key through the real SecretStorage.

## CLI: @napi-rs/keyring

`@napi-rs/keyring` (MIT, maintained, 2.1.2 on npm in November 2026) binds the Rust `keyring` crate through N-API and ships prebuilt binaries as optional platform packages, so there is no compile step at install. David approved it on 2026-11-15 and it is pinned to 2.1.2 in `apps/cli` only. The Linux binaries statically link `libdbus` (`AFL-2.1 OR GPL-2.0-or-later`); each platform package ships `LICENSE.third-party.md`.

The implementation is `KeychainKeyStore` in `apps/cli/src/keys/keychain.ts`. It is in the CLI package, not core, so core and the extension bundle never need the native binary, and it loads the module with a dynamic `import()` on first use. Accounts are `apiKey.<provider>` under service `blame`, plus `index.apiKey`, a JSON list of provider ids with no secrets, so `list()` never enumerates secret values. Errors are `KeychainError` with a fixed message and a `code`; the native error text and `cause` are dropped because a native message could echo a secret.

```ts
import { AsyncEntry } from "@napi-rs/keyring";

const SERVICE = "blame";

function entryFor(provider: string): AsyncEntry {
  // Same provider id rule as the extension. On Linux require Secret Service so a missing
  // keyring is an error, not a silent switch to a store that forgets keys at reboot.
  return new AsyncEntry(SERVICE, `apiKey.${provider}`, { linux: { store: "secret-service" } });
}

await entryFor("openai").setPassword(key);          // write
const value = await entryFor("openai").getPassword(); // string | null
await entryFor("openai").deletePassword();            // true if something was deleted
```

Use `AsyncEntry` so keychain calls (which can show an OS prompt on macOS) never block the TUI.

Platform notes:

- Linux: without the `linux.store` option, the binding tries Secret Service and silently falls back to the kernel keyutils keyring, which lives in memory and does not survive a reboot. FR-KEY-1 wants a clear outcome, so pin `secret-service` and turn the error into `keychain_unavailable`. The store itself never falls back: it does not read or write environment variables or files. The user can set the provider's own environment variable for Pi to read. `--insecure-file-store` is not built; adding it needs David's yes, and then it must use mode 0600 and say so.
- Linux headless (SSH, CI, containers): there is usually no Secret Service. Environment variables are the expected path there. Document it in the install troubleshooting (APP_FLOW, "keychain missing on Linux").
- Windows: Credential Manager generic credentials hold at most 2560 bytes (`CRED_MAX_CREDENTIAL_BLOB_SIZE`, 5 x 512). API keys fit. OAuth token sets (ChatGPT sign-in, Blame account refresh tokens) may not; store the refresh token and access token as separate entries, or keep only the refresh token and re-mint access tokens, and test with a realistic token length.
- macOS: the first read from a new binary can show a Keychain access prompt. A rebuilt or re-signed binary can prompt again. That is expected, not a bug to work around.
- Bundling: the native `.node` file cannot be inlined by a bundler. If the CLI is ever bundled, mark `@napi-rs/keyring` as external and ship it as a real dependency.

## The CredentialStore for Pi

Pi's `CredentialStore` (from `@earendil-works/pi-ai`) has `read`, `list`, `modify` and `delete`. `modify(providerId, fn)` is the only write path and must be serialized per provider, because Pi runs OAuth refresh inside it. Implement it in `packages/core/src/keys/` (ARCHITECTURE section 3):

- Keychain-backed store for the CLI: `keyStoreCredentials(new KeychainKeyStore())`, keyed the same way as above. Serialize `modify` with a per-provider promise chain in process. Two `blame` processes can still race on refresh; note that limit in code and in the PR.
- In-memory store for the RPC child, filled from the keys the extension sends at session start. Nothing is persisted from the child; token refreshes are sent back to the extension to store in SecretStorage.
- `list()` returns only provider ids and types, never secret values.
- Wire it with `ModelRuntime.create({ credentials })`. For a one-off key, `modelRuntime.setRuntimeApiKey(provider, key)` keeps it in memory.

## Tests

- No plaintext: after a session with a fake key, grep `~/.blame`, Blame's config dir and `~/.pi` for the key; expect no match (Phase 1 Verify, FR-KEY-2).
- Linux without Secret Service: the store throws `keychain_unavailable` with next steps, names the provider env var as the user's alternative, and writes nothing (`apps/cli/test/keychain.test.ts`). The real keychain round trip is `apps/cli/test/keychain.real.test.ts`, opt-in with `BLAME_KEYCHAIN_TEST=1`.
- Windows: storing a value over 2560 bytes fails with a clear message, not a crash.
- Revoke: every Blame secret is gone from SecretStorage and the keychain, and the output lists each one.
- Redaction: a fake key placed in a tool result never reaches model context or logs (T-02).
- Use obviously fake keys (for example `fake-key-for-tests`). gitleaks runs on every PR.

Keychain tests touch the real OS store, so keep them out of default `pnpm test` unless they clean up after themselves and skip cleanly when no keychain exists.

## Sources

- VS Code SecretStorage: https://code.visualstudio.com/api/references/vscode-api#SecretStorage
- VS Code keyring backends on Linux (`password-store`): https://code.visualstudio.com/docs/configure/settings-sync
- Electron safeStorage: https://www.electronjs.org/docs/latest/api/safe-storage
- @napi-rs/keyring: https://github.com/Brooooooklyn/keyring-node
- keytar archive status: https://github.com/atom/node-keytar
- Windows credential size limit: https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw
- Pi CredentialStore at 1.5.2: https://github.com/earendil-works/pi/blob/v1.5.2/packages/ai/src/auth/types.ts

---
name: blame-vscode-extension
description: Building, debugging, testing and packaging Blame's VS Code extension in apps/vscode (package name blame, id blame-ai.blame). Use when touching apps/vscode, its esbuild bundle, the @vscode/test-cli integration tests under xvfb, SecretStorage, the core child process, per-hunk accept and reject with WorkspaceEdit, webviews, or publishing to the VS Code Marketplace and Open VSX.
---

# Blame VS Code extension (apps/vscode)

The extension is a thin host. It holds no agent logic (TRD TG-1): it registers commands, owns the webviews and SecretStorage, and runs `@blame-ai/core` as a child process over Pi RPC (see the blame-pi-engine skill). It must work in VS Code, Cursor and Windsurf. Product and design rules live in PRD F23.1, TRD FR-EXT-1 to FR-EXT-3, ARCHITECTURE section 5.1 and DESIGN.md; this skill is the how-to.

## Layout and facts from the repo

| File | What it does |
|---|---|
| `package.json` | name `blame`, publisher `blame-ai` (id `blame-ai.blame`), `engines.vscode ^1.105.0`, `main ./dist/extension.js`, activation `onCommand:blame.open`, `"private": true` for now |
| `esbuild.mjs` | One CommonJS bundle `dist/extension.js`, `platform: node`, `target: node22`, `external: ["vscode"]`, sourcemaps, minified when `NODE_ENV=production` |
| `src/extension.ts` | `activate()` registers `blame.open` and returns `{ keys }` for tests |
| `src/keyStore.ts` | BYOK keys on `context.secrets` under `blame.apiKey.<provider>` |
| `test/*.test.ts` | Vitest unit tests (run in Node, no VS Code) |
| `src/test/suite/*.test.ts` | Integration tests that run inside VS Code (Mocha `tdd` UI: `suite`, `test`) |
| `tsconfig.e2e.json` | Compiles `src/test/**` to `out/` (Node16 modules) for the test host |
| `.vscode-test.mjs` | `@vscode/test-cli` config: `files: out/test/**/*.test.js`, `version: stable`, `--disable-extensions`, 20 s Mocha timeout |
| `.vscodeignore` | Ships only `dist/extension.js`, `package.json`, `README.md`, `LICENSE` |

`@blame-ai/core` and `@blame-ai/design-tokens` are `devDependencies` on purpose: esbuild inlines them, so the VSIX has no `node_modules`.

## Commands

Run from the repo root:

| Task | Command |
|---|---|
| Build the bundle | `pnpm --filter blame build` |
| Typecheck | `pnpm --filter blame typecheck` |
| Unit tests | `pnpm --filter blame test` |
| Integration tests, Linux or CI | `xvfb-run -a pnpm --filter blame test:e2e` |
| Integration tests, Windows or macOS desktop | `pnpm --filter blame test:e2e` (no xvfb needed) |
| One labeled config only | `pnpm --filter blame exec vscode-test --label <label>` once labels exist |

`test:e2e` compiles the suite with `tsconfig.e2e.json`, rebuilds the bundle, then runs `vscode-test`, which downloads VS Code stable into `.vscode-test/` (gitignored) and launches it with the extension under development. Headless Linux needs an X server, which is why CI wraps it in `xvfb-run -a` (VS Code CI guide). Windows E2E in CI is planned, not built (AGENTS.md table); do not claim it passes.

## Debugging

There is no checked-in `.vscode/launch.json` yet. To debug locally, add one (and propose it in a PR if it helps others) using the documented extension host launch type:

```jsonc
{
  "name": "Run Blame extension",
  "type": "extensionHost",
  "request": "launch",
  "args": ["--disable-extensions", "--extensionDevelopmentPath=${workspaceFolder}/apps/vscode"],
  "outFiles": ["${workspaceFolder}/apps/vscode/dist/**/*.js"]
}
```

Run `pnpm --filter blame build` first (or add a `preLaunchTask` that runs it). `--disable-extensions` keeps your other extensions out of the test host. Breakpoints in `src/` work through the esbuild sourcemap. In Cursor the same launch type works because Cursor is a VS Code fork; test there too before saying "works in Cursor" (TESTING.md section 3).

## Rules for extension code

- Activation registers commands only and stays under 1 s (R-PERF-5, FR-EXT-1). Start the core child lazily on first use, never in `activate()`.
- Push every disposable to `context.subscriptions`.
- Keys: only `context.secrets` (`get`, `store`, `delete`, `keys()`, `onDidChange` in the 1.105 API). Never settings JSON, `globalState`, logs or webview state. See the blame-key-storage skill.
- The core child: spawn `process.execPath` with `ELECTRON_RUN_AS_NODE=1` when `process.versions.node` is 22.19 or newer, else a Node from PATH, else show an install prompt (ARCHITECTURE 4). A crash of the child must not take down the extension host; restart it and resume from the session file.
- Webviews: strict CSP with a nonce per load, `localResourceRoots` limited to the extension's own media folder, no inline scripts, and treat every message from the webview as untrusted input (T-18). Use `--vscode-*` CSS variables for editor chrome and design tokens for Blame colors (DESIGN.md). Check dark, light, high contrast and high contrast light.
- No proposed APIs. Anything in `enabledApiProposals` blocks Marketplace and Open VSX publishing (ARCHITECTURE 5.1, FR-EXT-3).

## Per-hunk accept and reject

The stable API has no way to accept or reject one hunk inside the native diff editor (ARCHITECTURE "Per-hunk accept and reject"). The decided design:

1. Show the change with the built-in `vscode.diff` command (original on the left, proposed on the right) for viewing only.
2. Put Accept and Reject controls on each hunk of Blame's proposed-change view with a `CodeLensProvider` and, for highlighting, `window.createTextEditorDecorationType` plus `TextEditor.setDecorations`.
3. Apply a decision with one `WorkspaceEdit` and `await workspace.applyEdit(edit)`. Check the returned boolean; `false` means the edit did not apply (for example the document changed), so refresh the hunks and tell the user.

Practical details:

- Serve the proposed side from a `TextDocumentContentProvider` on a Blame URI scheme, so nothing is written to disk until the user accepts.
- Compute hunks against the current document text, not a cached copy. Before applying a hunk, check that the original lines still match; if not, recompute.
- Apply hunks bottom to top inside one file, or rebase later ranges after each edit, so line numbers stay valid.
- After accepting, emit the event core needs for the checkpoint on `blame/<task>` (APP_FLOW "Diff review"). Reject must leave the file byte for byte unchanged.
- Integration tests: open a fixture file, feed a known proposed change, run the accept command for hunk 2 only, and assert the exact resulting text. Do the same for reject.

## Packaging and publishing

Publishing is planned (IMPLEMENTATION_PLAN late phase, ARCHITECTURE 11: tag `vscode-v*` packages and publishes with `vsce` and `ovsx` from the same VSIX). Nothing publishes today, and publishing needs David's approval and his publisher accounts. When the time comes:

1. Remove `"private": true` from `apps/vscode/package.json` only in the release PR, and add `README.md` and `LICENSE` to the folder (`.vscodeignore` already allows them).
2. Package once: `pnpm dlx @vscode/vsce package --no-dependencies -o blame.vsix` from `apps/vscode`. `--no-dependencies` is right because the bundle already contains everything and vsce's npm-based dependency walk does not understand pnpm's layout.
3. Inspect the VSIX before publishing: `pnpm dlx @vscode/vsce ls --no-dependencies` should list only the files `.vscodeignore` allows.
4. Publish that same file to both registries: `vsce publish --packagePath blame.vsix` (with `--oidc` in CI, see below) and `ovsx publish --packagePath blame.vsix`.

Credentials, as documented in November 2026:

- VS Code Marketplace: Azure DevOps global Personal Access Tokens are retired on December 1, 2026. Use Marketplace Trusted Publishing from GitHub Actions instead: create a policy on the publisher page (owner, repo, workflow file, optional environment), give the job `permissions: id-token: write`, and run `vsce publish --oidc`. For a private repo the workflow must run within 48 hours of creating the policy.
- Open VSX: create an eclipse.org account, sign the Publisher Agreement, create an access token, then `ovsx create-namespace blame-ai -p <token>` once. CI uses an `OVSX_PAT` secret. `ovsx` 1.4.0 also has `--trusted-publishing` for OIDC; confirm open-vsx.org supports it for the namespace before relying on it.
- Version numbers are `major.minor.patch` only. Pre-releases use `--pre-release` with a separate minor line (VS Code docs suggest odd minor for pre-release).
- Pin every action in the release workflow by commit SHA and never use `pull_request_target` (AGENTS.md).

## Sources

- Extension API reference: https://code.visualstudio.com/api/references/vscode-api
- Built-in commands (`vscode.diff`): https://code.visualstudio.com/api/references/commands
- Testing extensions (`@vscode/test-cli`, launch config): https://code.visualstudio.com/api/working-with-extensions/testing-extension
- Continuous integration (xvfb): https://code.visualstudio.com/api/working-with-extensions/continuous-integration
- Bundling with esbuild: https://code.visualstudio.com/api/working-with-extensions/bundling-extension
- Webviews and CSP: https://code.visualstudio.com/api/extension-guides/webview
- Publishing, Trusted Publishing and pre-releases: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- Open VSX publishing: https://github.com/eclipse/openvsx/wiki/Publishing-Extensions

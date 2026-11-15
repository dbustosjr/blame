import { writeFileSync } from "node:fs";
import { build } from "esbuild";

// `--metafile` writes dist/<name>.meta.json so tests can check what went into each bundle.
const metafile = process.argv.includes("--metafile");
const minify = process.env.NODE_ENV === "production";

// The extension host bundle (CommonJS). `vscode` is provided by the editor at runtime. It takes
// the engine client from @blame-ai/core/engine-client, which never loads Pi.
const extension = await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  format: "cjs",
  platform: "node",
  target: "node22",
  external: ["vscode"],
  conditions: ["@blame-ai/source"],
  // The client's default entry uses import.meta.url, which is empty in CJS. The extension always
  // passes `entry` explicitly (dist/engine.mjs), so that default is never used here.
  logOverride: { "empty-import-meta": "silent" },
  sourcemap: true,
  minify,
  metafile,
  logLevel: "info",
});

// The engine (ESM, with Pi). The extension spawns it as a child with process.execPath and
// ELECTRON_RUN_AS_NODE, passing this file's absolute path, so it works from the packaged .vsix.
const engine = await build({
  entryPoints: ["../../packages/core/src/rpc/main.ts"],
  bundle: true,
  outfile: "dist/engine.mjs",
  format: "esm",
  platform: "node",
  target: "node22",
  conditions: ["@blame-ai/source"],
  banner: {
    js: "import { createRequire as __blameCreateRequire } from 'node:module'; const require = __blameCreateRequire(import.meta.url);",
  },
  sourcemap: false,
  minify,
  metafile,
  logLevel: "info",
});

if (metafile) {
  writeFileSync("dist/extension.meta.json", JSON.stringify(extension.metafile));
  writeFileSync("dist/engine.meta.json", JSON.stringify(engine.metafile));
}

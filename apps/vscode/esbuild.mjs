import { build } from "esbuild";

// One CommonJS bundle for the extension host. `vscode` is provided by the editor at runtime.
await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  format: "cjs",
  platform: "node",
  target: "node22",
  external: ["vscode"],
  sourcemap: true,
  minify: process.env.NODE_ENV === "production",
  logLevel: "info",
});

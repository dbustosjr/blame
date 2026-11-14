#!/usr/bin/env node
// Import boundary (TG-1, IMPLEMENTATION_PLAN Phase 0 task 5): only packages/core may import Pi
// (@earendil-works/*), in code or as a package.json dependency.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "out",
  ".next",
  ".git",
  ".vscode-test",
  "coverage",
  "fixtures",
]);
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const PI_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']@earendil-works\/[^"']*["']/;
const ALLOWED_PREFIX = `packages${sep}core${sep}`;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
    } else {
      yield join(dir, entry.name);
    }
  }
}

/** Returns violations as "path:line: text" strings. */
export function findViolations(root) {
  const violations = [];
  for (const file of walk(root)) {
    const rel = relative(root, file);
    if (rel.startsWith(ALLOWED_PREFIX)) continue;
    if (CODE.test(file)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (PI_IMPORT.test(line)) violations.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    } else if (file.endsWith("package.json")) {
      const pkg = JSON.parse(readFileSync(file, "utf8"));
      for (const field of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
      ]) {
        for (const name of Object.keys(pkg[field] ?? {})) {
          if (name.startsWith("@earendil-works/")) violations.push(`${rel}: ${field} has ${name}`);
        }
      }
    }
  }
  return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? process.cwd();
  const violations = findViolations(root);
  if (violations.length > 0) {
    console.error("Only packages/core may import Pi (@earendil-works/*). Violations:");
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log("Import boundary OK: Pi is imported only from packages/core.");
}

#!/usr/bin/env node
// No em dashes or en dashes in Markdown (TRD C-10). Scans files tracked by git.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DASHES = /[\u2013\u2014]/;

/** Returns "path:line" strings for lines with an em or en dash. */
export function findDashes(files, read = (f) => readFileSync(f, "utf8")) {
  const hits = [];
  for (const file of files) {
    read(file)
      .split("\n")
      .forEach((line, i) => {
        if (DASHES.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
      });
  }
  return hits;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = execFileSync("git", ["ls-files", "-z", "--", "*.md"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  const hits = findDashes(files);
  if (hits.length > 0) {
    console.error("Em or en dashes found. Use a comma, colon, parentheses or 'to' instead:");
    for (const h of hits) console.error(`  ${h}`);
    process.exit(1);
  }
  console.log(`No em or en dashes in ${files.length} Markdown files.`);
}

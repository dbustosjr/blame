import { readFileSync } from "node:fs";

/** Version from this package's package.json (one level up from both src/ and dist/). */
export function readVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

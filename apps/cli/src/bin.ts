#!/usr/bin/env node
import { envKeySource } from "./engine/keySource.js";
import { main } from "./main.js";

// Read BLAME_API_KEY first and delete it from the environment before anything else runs.
const envKey = envKeySource(process.env);

process.exitCode = await main(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: process.cwd(),
  stdin: process.stdin,
  envKey,
});

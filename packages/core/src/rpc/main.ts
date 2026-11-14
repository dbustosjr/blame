#!/usr/bin/env node
// Blame's engine child entry (ADR-0006). Spawned by BlameEngineClient; speaks Blame's JSONL
// protocol on stdin and stdout. Keys arrive in the init request, never in argv or env.
import { scrubEngineEnv } from "./runtime.js";
import { runEngineServer } from "./server.js";

// Pi falls back to provider keys in the environment; the engine uses init.apiKey only (#38).
// ES module imports load Pi first; this still runs before any provider auth is resolved.
scrubEngineEnv(process.env);
runEngineServer();

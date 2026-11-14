#!/usr/bin/env node
// Blame's engine child entry (ADR-0006). Spawned by BlameEngineClient; speaks Blame's JSONL
// protocol on stdin and stdout. Keys arrive in the init request, never in argv or env.
import { runEngineServer } from "./server.js";

runEngineServer();

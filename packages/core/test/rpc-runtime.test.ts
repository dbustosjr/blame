import { describe, expect, it } from "vitest";
import { MIN_ENGINE_NODE_VERSION, resolveEngineRuntime } from "../src/index.js";

describe("resolveEngineRuntime", () => {
  it("uses process.execPath under plain Node", () => {
    const r = resolveEngineRuntime({
      execPath: "/usr/bin/node",
      versions: { node: "22.19.0" },
      env: {},
    });
    expect(r).toEqual({ ok: true, command: "/usr/bin/node", env: {} });
  });

  it("runs an editor's Electron as Node when its Node is new enough", () => {
    const r = resolveEngineRuntime({
      execPath: "/Applications/Code.app/Electron",
      versions: { node: "22.20.0", electron: "37.0.0" },
      env: { PATH: "/bin" },
    });
    expect(r).toEqual({
      ok: true,
      command: "/Applications/Code.app/Electron",
      env: { PATH: "/bin", ELECTRON_RUN_AS_NODE: "1" },
    });
  });

  it("falls back to node on PATH when the host Node is too old", () => {
    const r = resolveEngineRuntime({
      execPath: "/x/Electron",
      versions: { node: "20.18.0", electron: "33.0.0" },
      env: {},
      fallbackNode: "node",
    });
    expect(r).toEqual({ ok: true, command: "node", env: {}, needsVersionCheck: true });
  });

  it("reports an error when the host Node is too old and there is no fallback", () => {
    const r = resolveEngineRuntime({ execPath: "/x/node", versions: { node: "22.18.9" }, env: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(MIN_ENGINE_NODE_VERSION);
  });

  it("does not let ELECTRON_RUN_AS_NODE leak to a plain node fallback", () => {
    const r = resolveEngineRuntime({
      execPath: "/x/Electron",
      versions: { node: "18.0.0", electron: "1" },
      env: { ELECTRON_RUN_AS_NODE: "1" },
      fallbackNode: "node",
    });
    expect(r).toMatchObject({ ok: true, env: {} });
  });

  it("uses an explicit command as is", () => {
    const r = resolveEngineRuntime({
      command: "/opt/node24",
      versions: { node: "1.0.0" },
      env: {},
    });
    expect(r).toEqual({ ok: true, command: "/opt/node24", env: {} });
  });
});

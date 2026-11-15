import { describe, expect, it, vi } from "vitest";
import {
  envKeySource,
  firstKeySource,
  type KeySource,
  promptKeySource,
} from "../src/engine/keySource.js";

const FAKE_KEY = ["sk", "blame", "cli", "fake", "key"].join("-");

describe("key sources (keychain store plugs in behind KeySource later)", () => {
  it("reads BLAME_API_KEY once and removes it from the environment", async () => {
    const env: NodeJS.ProcessEnv = { BLAME_API_KEY: ` ${FAKE_KEY} `, PATH: "/bin" };
    const source = envKeySource(env);
    expect(env.BLAME_API_KEY).toBeUndefined();
    expect(env.PATH).toBe("/bin");
    expect(await source.get("anthropic")).toBe(FAKE_KEY);
    expect(source.name).toBe("BLAME_API_KEY");
  });

  it("gives nothing when the variable is unset or blank", async () => {
    expect(await envKeySource({}).get("anthropic")).toBeUndefined();
    expect(await envKeySource({ BLAME_API_KEY: "  " }).get("anthropic")).toBeUndefined();
  });

  it("asks through a masked prompt that names the provider", async () => {
    const ask = vi.fn(async (_q: string) => FAKE_KEY);
    const source = promptKeySource(ask);
    expect(await source.get("openai")).toBe(FAKE_KEY);
    expect(ask.mock.calls[0]?.[0]).toContain("openai");
    const blank = promptKeySource(async () => "");
    expect(await blank.get("openai")).toBeUndefined();
    const gone = promptKeySource(async () => undefined);
    expect(await gone.get("openai")).toBeUndefined();
  });

  it("tries sources in order and stops at the first key", async () => {
    const later: KeySource = { name: "later", get: vi.fn(async () => "other") };
    const first = firstKeySource([envKeySource({ BLAME_API_KEY: FAKE_KEY }), later]);
    expect(await first.get("anthropic")).toBe(FAKE_KEY);
    expect(later.get).not.toHaveBeenCalled();
    const fallback = firstKeySource([envKeySource({}), later]);
    expect(await fallback.get("anthropic")).toBe("other");
  });
});

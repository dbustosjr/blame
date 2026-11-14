import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  defaultPolicy,
  effectiveLevel,
  evaluate,
  globToRegExp,
  grantedCapabilities,
  matchesSafeZone,
  orderedLevels,
  type PolicyConfig,
  PolicyConfigError,
  type PolicyContext,
  validatePolicyConfig,
} from "../src/index.js";

function loadFixture(name: string): PolicyConfig {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  ) as PolicyConfig;
}

const fixtures: Array<[string, PolicyConfig]> = [
  ["5-level seed (L0 to L4)", defaultPolicy],
  ["5-level fixture", loadFixture("policy-5-levels.json")],
  ["3-level fixture", loadFixture("policy-3-levels.json")],
];

describe.each(fixtures)("policy from data: %s", (_name, config) => {
  const levels = orderedLevels(config);
  const lowest = levels[0]?.id as string;
  const highest = levels.at(-1)?.id as string;
  const ctx = (presetId: string, earnedLevelId: string, extra: Partial<PolicyContext> = {}) => ({
    presetId,
    earnedLevelId,
    optedIn: true,
    sandboxAvailable: true,
    ...extra,
  });

  it("validates", () => {
    expect(() => validatePolicyConfig(config)).not.toThrow();
  });

  it("effective level is the lower of preset ceiling and earned level", () => {
    for (const preset of config.presets) {
      const ceiling = config.levels.find((l) => l.id === preset.ceiling);
      for (const earned of levels) {
        const eff = effectiveLevel(config, preset.id, earned.id);
        expect(eff.rank).toBe(Math.min(earned.rank, ceiling?.rank ?? Number.NaN));
      }
    }
  });

  it("levels are cumulative", () => {
    const low = grantedCapabilities(config, lowest);
    const high = grantedCapabilities(config, highest);
    for (const cap of low) expect(high.has(cap)).toBe(true);
    expect(high.size).toBeGreaterThan(low.size);
  });

  it("manual asks for edits even at the highest earned level", () => {
    const r = evaluate(config, ctx("manual", highest), { capability: "edit_workspace" });
    expect(r.decision).toBe("ask");
    expect(evaluate(config, ctx("manual", highest), { capability: "read" }).decision).toBe("allow");
  });

  it("guided allows workspace edits once earned, and asks before that", () => {
    expect(
      evaluate(config, ctx("guided", highest), { capability: "edit_workspace" }).decision,
    ).toBe("allow");
    expect(evaluate(config, ctx("guided", lowest), { capability: "edit_workspace" }).decision).toBe(
      "ask",
    );
  });

  it("a preset never exceeds its ceiling", () => {
    const r = evaluate(config, ctx("guided", highest), { capability: "edit_ci" });
    expect(r.decision).toBe("ask");
    expect(r.effectiveLevelId).toBe(config.presets.find((p) => p.id === "guided")?.ceiling);
  });

  it("safe zones always ask, in every preset and at every level", () => {
    for (const preset of config.presets) {
      for (const level of levels) {
        for (const path of ["auth/login.ts", "src/payments/charge.ts", "db/migrations/001.sql"]) {
          const r = evaluate(config, ctx(preset.id, level.id), {
            capability: "read",
            paths: [path],
          });
          expect(r.decision, `${preset.id} ${level.id} ${path}`).toBe("ask");
        }
      }
    }
  });

  it("risky actions ask below the risky threshold", () => {
    const r = evaluate(config, ctx("guided", highest), {
      capability: "run_tests",
      riskyClass: "secret_access",
    });
    expect(r.decision).toBe("ask");
  });

  it("autonomous needs opt-in and the sandbox", () => {
    expect(
      evaluate(config, ctx("autonomous", highest, { optedIn: false }), { capability: "read" })
        .decision,
    ).toBe("block");
    expect(
      evaluate(config, ctx("autonomous", highest, { sandboxAvailable: false }), {
        capability: "read",
      }).decision,
    ).toBe("block");
  });

  it("blocks unknown capabilities", () => {
    expect(evaluate(config, ctx("guided", highest), { capability: "format_disk" }).decision).toBe(
      "block",
    );
  });
});

describe("seed data", () => {
  it("has Manual, Guided (default) and Autonomous", () => {
    expect(defaultPolicy.presets.map((p) => p.label)).toEqual(["Manual", "Guided", "Autonomous"]);
    expect(defaultPolicy.presets.find((p) => p.isDefault)?.id).toBe("guided");
  });

  it("autonomous at L3 still asks for risky classes and safe zones", () => {
    const context = {
      presetId: "autonomous",
      earnedLevelId: "L3",
      optedIn: true,
      sandboxAvailable: true,
    };
    expect(evaluate(defaultPolicy, context, { capability: "edit_ci" }).decision).toBe("allow");
    expect(
      evaluate(defaultPolicy, context, { capability: "edit_ci", riskyClass: "ci_change" }).decision,
    ).toBe("ask");
    expect(
      evaluate(defaultPolicy, context, { capability: "edit_workspace", paths: ["auth/x.ts"] })
        .decision,
    ).toBe("ask");
  });

  it("the 3-level fixture lets an opted-in autonomous ship level take risky actions", () => {
    const config = loadFixture("policy-3-levels.json");
    const context = {
      presetId: "autonomous",
      earnedLevelId: "ship",
      optedIn: true,
      sandboxAvailable: true,
    };
    expect(
      evaluate(config, context, { capability: "edit_deps", riskyClass: "ci_change" }).decision,
    ).toBe("allow");
  });
});

describe("config validation", () => {
  it("rejects duplicate ranks and unknown ceilings", () => {
    const dupRank = {
      ...defaultPolicy,
      levels: [...defaultPolicy.levels, { id: "LX", rank: 0, name: "X", capabilities: [] }],
    };
    expect(() => validatePolicyConfig(dupRank)).toThrow(PolicyConfigError);
    const badCeiling = {
      ...defaultPolicy,
      presets: defaultPolicy.presets.map((p) => ({ ...p, ceiling: "nope" })),
    };
    expect(() => validatePolicyConfig(badCeiling)).toThrow(PolicyConfigError);
  });
});

describe("safe zone globs", () => {
  it("matches nested paths and Windows separators", () => {
    expect(matchesSafeZone("auth/a.ts", "auth/**")).toBe(true);
    expect(matchesSafeZone("src\\auth\\a.ts", "auth/**")).toBe(true);
    expect(matchesSafeZone("./payments/x/y.ts", "payments/**")).toBe(true);
    expect(matchesSafeZone("src/author.ts", "auth/**")).toBe(false);
    expect(globToRegExp("*.sql").test("a.sql")).toBe(true);
    expect(globToRegExp("*.sql").test("a/b.sql")).toBe(false);
  });
});

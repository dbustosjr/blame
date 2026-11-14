import { matchesSafeZone } from "./glob.js";
import type {
  ActionRequest,
  AutonomyPreset,
  Capability,
  PolicyConfig,
  PolicyContext,
  PolicyResult,
  TrustLevel,
} from "./types.js";

export class PolicyConfigError extends Error {
  override name = "PolicyConfigError";
}

/** Throws PolicyConfigError when the config cannot be evaluated safely. */
export function validatePolicyConfig(config: PolicyConfig): void {
  if (config.levels.length === 0) throw new PolicyConfigError("At least one trust level is needed");
  const ids = new Set<string>();
  const ranks = new Set<number>();
  for (const level of config.levels) {
    if (ids.has(level.id)) throw new PolicyConfigError(`Duplicate level id ${level.id}`);
    if (ranks.has(level.rank)) throw new PolicyConfigError(`Duplicate level rank ${level.rank}`);
    ids.add(level.id);
    ranks.add(level.rank);
  }
  if (!ids.has(config.riskyAllowedFromLevel)) {
    throw new PolicyConfigError(`Unknown riskyAllowedFromLevel ${config.riskyAllowedFromLevel}`);
  }
  const presetIds = new Set<string>();
  for (const preset of config.presets) {
    if (presetIds.has(preset.id)) throw new PolicyConfigError(`Duplicate preset id ${preset.id}`);
    presetIds.add(preset.id);
    if (!ids.has(preset.ceiling)) {
      throw new PolicyConfigError(`Preset ${preset.id} has unknown ceiling ${preset.ceiling}`);
    }
  }
  if (config.presets.filter((p) => p.isDefault).length !== 1) {
    throw new PolicyConfigError("Exactly one preset must be the default");
  }
}

/** Levels ordered from least to most trusted. */
export function orderedLevels(config: PolicyConfig): TrustLevel[] {
  return [...config.levels].sort((a, b) => a.rank - b.rank);
}

export function getLevel(config: PolicyConfig, id: string): TrustLevel {
  const level = config.levels.find((l) => l.id === id);
  if (!level) throw new PolicyConfigError(`Unknown trust level ${id}`);
  return level;
}

export function getPreset(config: PolicyConfig, id: string): AutonomyPreset {
  const preset = config.presets.find((p) => p.id === id);
  if (!preset) throw new PolicyConfigError(`Unknown preset ${id}`);
  return preset;
}

export function defaultPreset(config: PolicyConfig): AutonomyPreset {
  const preset = config.presets.find((p) => p.isDefault);
  if (!preset) throw new PolicyConfigError("No default preset");
  return preset;
}

/** Effective level: the lower of the preset ceiling and the earned level (R-AUTO-2). */
export function effectiveLevel(
  config: PolicyConfig,
  presetId: string,
  earnedLevelId: string,
): TrustLevel {
  const ceiling = getLevel(config, getPreset(config, presetId).ceiling);
  const earned = getLevel(config, earnedLevelId);
  return earned.rank < ceiling.rank ? earned : ceiling;
}

/** Every capability a level grants: its own plus all levels below it. */
export function grantedCapabilities(config: PolicyConfig, levelId: string): Set<Capability> {
  const target = getLevel(config, levelId);
  const granted = new Set<Capability>();
  for (const level of orderedLevels(config)) {
    if (level.rank > target.rank) break;
    for (const cap of level.capabilities) granted.add(cap);
  }
  return granted;
}

function knownCapabilities(config: PolicyConfig): Set<Capability> {
  return new Set(config.levels.flatMap((l) => l.capabilities));
}

/**
 * Decide allow, ask or block for one action (TRD 4.4, FR-CORE-3).
 *
 * Order: preset start checks, effective level, risky classes, then safe zones last so nothing can
 * turn a safe-zone "ask" back into "allow". Budget and credential scope checks land in Phase 2.
 */
export function evaluate(
  config: PolicyConfig,
  context: PolicyContext,
  action: ActionRequest,
): PolicyResult {
  const preset = getPreset(config, context.presetId);
  const level = effectiveLevel(config, preset.id, context.earnedLevelId);
  const result = (decision: PolicyResult["decision"], reason: string): PolicyResult => ({
    decision,
    reason,
    effectiveLevelId: level.id,
  });

  if (preset.requiresOptIn && !context.optedIn) {
    return result("block", `${preset.label} needs an explicit opt-in for this workspace`);
  }
  if (preset.requiresSandbox && !context.sandboxAvailable) {
    return result("block", `${preset.label} refuses to run without the sandbox`);
  }
  if (!knownCapabilities(config).has(action.capability)) {
    return result("block", `Unknown capability ${action.capability}`);
  }

  let decision: PolicyResult = result("allow", `${level.id} allows ${action.capability}`);

  if (!grantedCapabilities(config, level.id).has(action.capability)) {
    decision = result("ask", `${action.capability} is above effective level ${level.id}`);
  } else if (preset.autoAllow !== "granted" && !preset.autoAllow.includes(action.capability)) {
    decision = result("ask", `${preset.label} asks before ${action.capability}`);
  } else if (action.riskyClass !== undefined) {
    const threshold = getLevel(config, config.riskyAllowedFromLevel);
    if (preset.alwaysAskRisky || level.rank < threshold.rank) {
      decision = result("ask", `Risky action ${action.riskyClass} needs approval`);
    }
  }

  const zoneHit = (action.paths ?? []).find((path) =>
    config.safeZones.some((zone) => matchesSafeZone(path, zone)),
  );
  if (zoneHit !== undefined && decision.decision === "allow") {
    decision = result("ask", `Safe zone: ${zoneHit} always needs a human`);
  }

  return decision;
}

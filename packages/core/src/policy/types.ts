/**
 * Autonomy and trust as data (TRD 4.4, FR-AUTO-3). No code branches on level numbers or preset
 * names: levels and presets are rows, ordered by `rank`, and everything is computed from them.
 */

/** Capabilities from PRD F2, used by the gate. Kept as a string so seed data can add more. */
export type Capability = string;

/** Risky-action classes from TRD 4.4. */
export type RiskyClass = string;

export interface TrustLevel {
  /** Stable id, for example "L2". */
  readonly id: string;
  /** Order of the level. Higher means more trust. Ranks must be unique. */
  readonly rank: number;
  /** Display name, for example "Contributor". */
  readonly name: string;
  /** Capabilities this level adds. A level also has every capability of the levels below it. */
  readonly capabilities: readonly Capability[];
}

export interface AutonomyPreset {
  /** Stable id used by `--mode`, for example "guided". */
  readonly id: string;
  /** Display label, for example "Guided". */
  readonly label: string;
  /** Highest trust level id this preset can use. */
  readonly ceiling: string;
  /**
   * Capabilities that may run without asking when the effective level grants them.
   * "granted" means every capability the effective level grants.
   */
  readonly autoAllow: "granted" | readonly Capability[];
  /**
   * Ask for risky-action classes even at or above `riskyAllowedFromLevel`. TRD 4.4 lists
   * Autonomous as "ask only for safe zones and risky-action classes", so every seed preset sets it.
   */
  readonly alwaysAskRisky: boolean;
  /** Needs an explicit opt-in per workspace before it can start (R-AUTO-1). */
  readonly requiresOptIn: boolean;
  /** Refuses to start without the OS sandbox, never falls back to unsandboxed (R-AUTO-4). */
  readonly requiresSandbox: boolean;
  /** The preset used when nothing is chosen. Exactly one preset sets this. */
  readonly isDefault?: boolean;
}

export interface PolicyConfig {
  readonly levels: readonly TrustLevel[];
  readonly presets: readonly AutonomyPreset[];
  /** Repo-relative globs that always pause for a human (F18, R-AUTO-3). No setting turns this off. */
  readonly safeZones: readonly string[];
  /** Risky-action classes are at least "ask" below this level id (TRD 4.4). */
  readonly riskyAllowedFromLevel: string;
}

export interface ActionRequest {
  readonly capability: Capability;
  /** Repo-relative paths the action touches, if any. */
  readonly paths?: readonly string[];
  /** Set when the risky-action classifier tags the action. */
  readonly riskyClass?: RiskyClass;
}

export interface PolicyContext {
  readonly presetId: string;
  /** Earned trust level id for this agent, repo and task class. */
  readonly earnedLevelId: string;
  /** Workspace opted in to presets that need it. */
  readonly optedIn: boolean;
  /** The OS sandbox is available and active. */
  readonly sandboxAvailable: boolean;
}

export type Decision = "allow" | "ask" | "block";

export interface PolicyResult {
  readonly decision: Decision;
  readonly reason: string;
  readonly effectiveLevelId: string;
}

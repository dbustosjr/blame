import type { PolicyConfig } from "./types.js";

/**
 * Seed data from PRD F2 (levels) and TRD 4.4 (presets). Stored as data so a different number of
 * levels or presets changes only this file and the theme ramp (FR-AUTO-3).
 */
export const defaultPolicy: PolicyConfig = {
  levels: [
    { id: "L0", rank: 0, name: "Probation", capabilities: ["read", "run_tests"] },
    { id: "L1", rank: 1, name: "Drafter", capabilities: ["edit_workspace", "open_draft_pr"] },
    { id: "L2", rank: 2, name: "Contributor", capabilities: ["run_allowlisted", "open_pr"] },
    {
      id: "L3",
      rank: 3,
      name: "Maintainer",
      capabilities: ["edit_ci", "edit_deps", "network_sandbox"],
    },
    { id: "L4", rank: 4, name: "Shipper", capabilities: ["deploy_preview"] },
  ],
  presets: [
    {
      id: "manual",
      label: "Manual",
      ceiling: "L1",
      autoAllow: ["read"],
      alwaysAskRisky: true,
      requiresOptIn: false,
      requiresSandbox: false,
    },
    {
      id: "guided",
      label: "Guided",
      ceiling: "L2",
      autoAllow: "granted",
      alwaysAskRisky: true,
      requiresOptIn: false,
      requiresSandbox: false,
      isDefault: true,
    },
    {
      id: "autonomous",
      label: "Autonomous",
      ceiling: "L3",
      autoAllow: "granted",
      alwaysAskRisky: true,
      requiresOptIn: true,
      requiresSandbox: true,
    },
  ],
  safeZones: ["payments/**", "auth/**", "migrations/**"],
  riskyAllowedFromLevel: "L3",
};

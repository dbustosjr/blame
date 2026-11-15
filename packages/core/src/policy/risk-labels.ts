/**
 * Plain-word labels for risky-action classes, shown in approval prompts instead of raw ids such
 * as `secret_access`. One map for every surface (CLI box, VS Code modal) so they always match.
 * Pi-free: exported from `@blame-ai/core/engine-client` too.
 */
export const RISK_LABELS: Readonly<Record<string, string>> = Object.freeze({
  secret_access: "file that may hold secrets",
  path_outside_workspace: "outside this workspace",
  ci_change: "changes CI workflows",
  unclassified_command: "shell command",
  safe_zone: "protected area (safe zone)",
});

/** Shown for a class this build does not know yet, so a raw id never reaches the user. */
export const UNKNOWN_RISK_LABEL = "needs your approval";

export function riskLabel(id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  return Object.hasOwn(RISK_LABELS, id) ? RISK_LABELS[id] : UNKNOWN_RISK_LABEL;
}

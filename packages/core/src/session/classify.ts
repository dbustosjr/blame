import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ActionRequest } from "../policy/types.js";

const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const EDIT_TOOLS = new Set(["edit", "write"]);
const SHELL_TOOLS = new Set(["bash", "powershell"]);
const CI_PATH = /^\.github\/workflows\//;
const DEPENDENCY_FILE =
  /(?:^|\/)(?:package\.json|package-lock\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|pyproject\.toml|uv\.lock|requirements[^/]*\.txt)$/;

/** A tool path as a repo-relative, forward-slash path, and whether it stays inside `cwd`. */
export function toRepoPath(path: string, cwd: string): { path: string; inside: boolean } {
  const rel = relative(cwd, resolve(cwd, path));
  const inside = rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  return { path: rel === "" ? "." : rel.split(sep).join("/"), inside };
}

function pathOf(input: Record<string, unknown>): string | undefined {
  return typeof input.path === "string" ? input.path : undefined;
}

/**
 * Maps a Pi tool call onto a policy action (TRD 4.4). This is the Phase 1 classifier: it knows
 * Pi's built-in tools only. Shell commands are always tagged risky until the Phase 2 risky-action
 * classifier and command allow-list land, and unknown tools get an unknown capability so the
 * policy blocks them (fail closed).
 */
export function classifyToolCall(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
): ActionRequest {
  const rawPath = pathOf(input);
  if (READ_TOOLS.has(toolName)) {
    return {
      capability: "read",
      paths: rawPath === undefined ? [] : [toRepoPath(rawPath, cwd).path],
    };
  }
  if (EDIT_TOOLS.has(toolName)) {
    if (rawPath === undefined) return { capability: "edit_workspace", paths: [] };
    const { path, inside } = toRepoPath(rawPath, cwd);
    if (!inside) {
      return { capability: "edit_workspace", paths: [path], riskyClass: "path_outside_workspace" };
    }
    if (CI_PATH.test(path))
      return { capability: "edit_ci", paths: [path], riskyClass: "ci_change" };
    if (DEPENDENCY_FILE.test(path)) return { capability: "edit_deps", paths: [path] };
    return { capability: "edit_workspace", paths: [path] };
  }
  if (SHELL_TOOLS.has(toolName)) {
    return { capability: "run_allowlisted", riskyClass: "unclassified_command" };
  }
  return { capability: `tool:${toolName}` };
}

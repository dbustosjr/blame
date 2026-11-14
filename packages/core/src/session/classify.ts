import { realpathSync } from "node:fs";
import nodePath, { type PlatformPath } from "node:path";
import type { ActionRequest } from "../policy/types.js";

const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const EDIT_TOOLS = new Set(["edit", "write"]);
const SHELL_TOOLS = new Set(["bash", "powershell"]);
const CI_PATH = /^\.github\/workflows\//;
const DEPENDENCY_FILE =
  /(?:^|\/)(?:package\.json|package-lock\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|pyproject\.toml|uv\.lock|requirements[^/]*\.txt)$/;

/** Templates that look like secrets by name but are meant to be committed. */
const SECRET_TEMPLATE = /^\.env\.(?:example|sample|template)$/i;
/** File names that usually hold credentials (TRD 4.4 `secret_access`, FR-CORE-8). */
const SECRET_NAME =
  /^(?:\.env(?:\..*)?|.*\.pem|.*\.key|id_.+|\.npmrc|\.netrc|_netrc|\.pgpass|\.git-credentials|credentials(?:\.json)?)$/i;
/** Directories whose contents are credentials. */
const SECRET_DIR = /^(?:\.ssh|\.aws|\.gnupg)$/i;

export interface ClassifyOptions {
  /** Path flavor. Default: the host's `node:path`. Tests pass `path.win32` or `path.posix`. */
  readonly pathApi?: PlatformPath;
  /** Resolves symlinks for a path that exists, and throws otherwise. Default: `fs.realpathSync.native`. */
  readonly realpath?: (path: string) => string;
}

function defaultRealpath(path: string): string {
  return realpathSync.native(path);
}

/**
 * Resolve symlinks for the longest existing prefix of `abs`, then re-append the rest. A file that
 * does not exist yet (a write target) is still judged by where its parent really is.
 */
function realish(abs: string, pathApi: PlatformPath, realpath: (p: string) => string): string {
  const rest: string[] = [];
  let current = abs;
  for (;;) {
    try {
      return pathApi.join(realpath(current), ...rest.reverse());
    } catch {
      const parent = pathApi.dirname(current);
      if (parent === current) return abs;
      rest.push(pathApi.basename(current));
      current = parent;
    }
  }
}

/**
 * A tool path as a repo-relative, forward-slash path, and whether it really stays inside `cwd`.
 * Resolves `..`, symlinks (where the path exists), and on Windows drive letters and case
 * (`path.win32.relative` compares case-insensitively and returns an absolute path across drives).
 */
export function toRepoPath(
  path: string,
  cwd: string,
  options: ClassifyOptions = {},
): { path: string; inside: boolean } {
  const pathApi = options.pathApi ?? nodePath;
  const realpath = options.realpath ?? defaultRealpath;
  const root = realish(pathApi.resolve(cwd), pathApi, realpath);
  const target = realish(pathApi.resolve(cwd, path), pathApi, realpath);
  const rel = pathApi.relative(root, target);
  // "~" is not expanded by node:path, but a tool or shell may expand it, so never call it inside.
  const inside =
    rel !== ".." &&
    !rel.startsWith(`..${pathApi.sep}`) &&
    !pathApi.isAbsolute(rel) &&
    !/^~(?:[\\/]|$)/.test(path);
  return { path: rel === "" ? "." : rel.split(pathApi.sep).join("/"), inside };
}

/** True when a path or glob names a credential file, is a credential directory, or sits in one. */
export function isSecretPath(path: string): boolean {
  const segments = path.split(/[\\/]+/).filter((s) => s !== "");
  const name = segments.at(-1) ?? "";
  if (segments.some((s) => SECRET_DIR.test(s))) return true;
  if (SECRET_TEMPLATE.test(name)) return false;
  // Globs such as "**/.env*", "*.pem" or "id_*": try each wildcard as empty and as one character.
  const empty = name.replace(/[*?]+/g, "");
  const filled = name.replace(/[*?]+/g, "x");
  return [name, empty, filled].some((n) => SECRET_NAME.test(n));
}

/** The path-like pattern a search tool walks: grep's `glob` or find's `pattern`. */
function searchPattern(toolName: string, input: Record<string, unknown>): string | undefined {
  const value = toolName === "grep" ? input.glob : toolName === "find" ? input.pattern : undefined;
  return typeof value === "string" ? value : undefined;
}

/** A search pattern that names secrets, or that is absolute or climbs with `..` (#22). */
function patternRisk(pattern: string, pathApi: PlatformPath): string | undefined {
  if (isSecretPath(pattern)) return "secret_access";
  const climbs = pattern.split(/[\\/]+/).includes("..");
  if (
    climbs ||
    pathApi.isAbsolute(pattern) ||
    nodePath.posix.isAbsolute(pattern) ||
    /^~(?:[\\/]|$)/.test(pattern)
  ) {
    return "path_outside_workspace";
  }
  return undefined;
}

function pathOf(input: Record<string, unknown>): string | undefined {
  return typeof input.path === "string" ? input.path : undefined;
}

function riskFor(rawPath: string, repoPath: string, inside: boolean): string | undefined {
  if (isSecretPath(rawPath) || isSecretPath(repoPath)) return "secret_access";
  if (!inside) return "path_outside_workspace";
  return undefined;
}

/**
 * Maps a Pi tool call onto a policy action (TRD 4.4). This is the Phase 1 classifier: it knows
 * Pi's built-in tools only.
 *
 * - Reads and edits outside the workspace are `path_outside_workspace`, and credential files are
 *   `secret_access` even inside it (secret wins when both apply). Both are risky, so every seed
 *   preset asks, including Manual, which otherwise auto-allows `read`.
 * - grep, find and ls are judged by their search root, and grep's `glob` and find's `pattern`
 *   are checked too: secret names are `secret_access`, and absolute or `..` patterns are
 *   `path_outside_workspace` (#22).
 * - Shell commands are always risky until the Phase 2 classifier and allow-list land, and unknown
 *   tools get an unknown capability so the policy blocks them (fail closed).
 */
export function classifyToolCall(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
  options: ClassifyOptions = {},
): ActionRequest {
  const rawPath = pathOf(input);
  if (READ_TOOLS.has(toolName)) {
    const glob = searchPattern(toolName, input);
    const globRisk =
      glob === undefined ? undefined : patternRisk(glob, options.pathApi ?? nodePath);
    if (rawPath === undefined) {
      return globRisk
        ? { capability: "read", paths: [], riskyClass: globRisk }
        : { capability: "read", paths: [] };
    }
    const { path, inside } = toRepoPath(rawPath, cwd, options);
    const riskyClass = riskFor(rawPath, path, inside) ?? globRisk;
    return riskyClass
      ? { capability: "read", paths: [path], riskyClass }
      : { capability: "read", paths: [path] };
  }
  if (EDIT_TOOLS.has(toolName)) {
    if (rawPath === undefined) return { capability: "edit_workspace", paths: [] };
    const { path, inside } = toRepoPath(rawPath, cwd, options);
    const riskyClass = riskFor(rawPath, path, inside);
    if (riskyClass) return { capability: "edit_workspace", paths: [path], riskyClass };
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

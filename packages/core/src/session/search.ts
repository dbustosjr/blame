import { existsSync, readdirSync, statSync } from "node:fs";
import {
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  type ExtensionFactory,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { isSecretPath } from "./classify.js";

/**
 * Secret-safe search (follow-up to #22 and #23). Pi 1.5.2's grep and find run ripgrep and fd with
 * fixed arguments (`--no-config`, `--hidden`) and take no ignore or exclude option (read from
 * `dist/core/tools/grep.js` and `find.js`), so a repo-wide search walks into `.env`, keys and
 * credential dirs. Blame overrides the three tools under Pi's names:
 *
 * - ls: Pi's `LsOperations.readdir` hook drops secret entries before Pi formats or counts them.
 * - grep and find: Pi's result text is post-filtered so secret file names and lines never come
 *   back. A search whose path or pattern explicitly targets secrets is not filtered, because the
 *   gate already tagged it `secret_access` and a human approved it.
 *
 * The secret set is `isSecretPath`, the same one that drives `secret_access`. Templates such as
 * `.env.example` stay searchable. Limits count before filtering, so a filtered page can be short.
 */

/** Template for the notice added when results were hidden. */
function hiddenNotice(hidden: number): string {
  return `[Blame hid ${hidden} result${hidden === 1 ? "" : "s"} from secret files. Name the file to ask for access.]`;
}

const GREP_LINE_MARK = /(?::\d+: |-\d+- )/g;

/** Every way a grep output line can split into "path" and the rest. */
function grepPathCandidates(line: string): string[] {
  const candidates: string[] = [];
  for (const match of line.matchAll(GREP_LINE_MARK)) candidates.push(line.slice(0, match.index));
  return candidates;
}

/**
 * Drops grep lines (`path:N: text` matches and `path-N- text` context) from secret files. When a
 * line can be read more than one way, it is dropped if any reading is a secret path (fail closed).
 */
export function filterGrepOutput(text: string): { text: string; hidden: number } {
  let hidden = 0;
  let kept = 0;
  const lines = text.split("\n").filter((line) => {
    const candidates = grepPathCandidates(line);
    if (candidates.length === 0) return true;
    if (candidates.some((path) => path !== "" && isSecretPath(path))) {
      hidden++;
      return false;
    }
    kept++;
    return true;
  });
  if (hidden === 0) return { text, hidden };
  if (kept === 0) return { text: "No matches found", hidden };
  return { text: lines.join("\n"), hidden };
}

/** Drops find results (one path per line, relative to the search root) that are secret. */
export function filterFindOutput(text: string): { text: string; hidden: number } {
  let hidden = 0;
  let kept = 0;
  const lines = text.split("\n").filter((line) => {
    if (line === "" || line.startsWith("[")) return true;
    if (isSecretPath(line)) {
      hidden++;
      return false;
    }
    kept++;
    return true;
  });
  if (hidden === 0) return { text, hidden };
  if (kept === 0) return { text: "No files found matching pattern", hidden };
  return { text: lines.join("\n"), hidden };
}

// biome-ignore lint/suspicious/noExplicitAny: wraps Pi tool definitions of any schema.
export type AnyToolDefinition = ToolDefinition<any, any>;

export interface SecretSafeSearchOptions {
  /** Tests: stand-ins for Pi's grep and find definitions. */
  readonly definitions?: { readonly grep?: AnyToolDefinition; readonly find?: AnyToolDefinition };
}

function stringParam(params: unknown, key: string): string | undefined {
  const value = (params as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" ? value : undefined;
}

function filtered(
  definition: AnyToolDefinition,
  filter: (text: string) => { text: string; hidden: number },
  explicitTargets: readonly string[],
): AnyToolDefinition {
  const execute: AnyToolDefinition["execute"] = async (
    toolCallId,
    params,
    signal,
    onUpdate,
    ctx,
  ) => {
    const result = await definition.execute(toolCallId, params, signal, onUpdate, ctx);
    const explicit = explicitTargets.some((key) => {
      const value = stringParam(params, key);
      return value !== undefined && isSecretPath(value);
    });
    if (explicit) return result;
    let hidden = 0;
    const content = result.content.map((block) => {
      if (block.type !== "text") return block;
      const out = filter(block.text);
      hidden += out.hidden;
      return { ...block, text: out.text };
    });
    if (hidden > 0) content.push({ type: "text", text: hiddenNotice(hidden) });
    return { ...result, content };
  };
  return { ...definition, execute };
}

/** Blame's grep, find and ls, which never return secret file names or contents by default. */
export function createSecretSafeSearchTools(
  cwd: string,
  options: SecretSafeSearchOptions = {},
): AnyToolDefinition[] {
  const grep = options.definitions?.grep ?? createGrepToolDefinition(cwd);
  const find = options.definitions?.find ?? createFindToolDefinition(cwd);
  const ls = createLsToolDefinition(cwd, {
    operations: {
      exists: (path) => existsSync(path),
      stat: (path) => statSync(path),
      // A directory that is itself secret was explicitly targeted and approved, so list it.
      readdir: (path) =>
        isSecretPath(path) ? readdirSync(path) : readdirSync(path).filter((e) => !isSecretPath(e)),
    },
  });
  return [
    filtered(grep, filterGrepOutput, ["path", "glob"]),
    filtered(find, filterFindOutput, ["path", "pattern"]),
    ls,
  ];
}

/** Inline extension that registers the secret-safe tools over Pi's built-ins. */
export function secretSafeSearchExtension(cwd: string): ExtensionFactory {
  return (pi) => {
    for (const tool of createSecretSafeSearchTools(cwd)) pi.registerTool(tool);
  };
}

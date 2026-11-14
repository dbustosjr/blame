/**
 * Small glob matcher for safe zones: `**` matches any number of path segments, `*` matches within
 * one segment, `?` matches one character. Paths use forward slashes.
 */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i] as string;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        const atSegmentEnd = glob[i + 2] === "/";
        out += atSegmentEnd ? "(?:.*/)?" : ".*";
        i += atSegmentEnd ? 2 : 1;
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/^\/+/, "");
}

/**
 * True when the path, or any trailing part of it, matches the glob. So `auth/**` also covers
 * `src/auth/session.ts`. Erring toward a match is deliberate: a false match only adds a prompt.
 */
export function matchesSafeZone(path: string, glob: string): boolean {
  const re = globToRegExp(normalizePath(glob));
  const segments = normalizePath(path).split("/");
  for (let i = 0; i < segments.length; i++) {
    if (re.test(segments.slice(i).join("/"))) return true;
  }
  return false;
}

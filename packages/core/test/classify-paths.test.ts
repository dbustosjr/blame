import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyToolCall,
  createAutonomyGate,
  defaultPolicy,
  type PolicyContext,
} from "../src/index.js";

// Reads were auto-allowed with no containment check, so a prompt-injected agent could read
// ~/.ssh, ~/.aws/credentials or another repo's .env without asking. These tests pin the fix.

describe("classifyToolCall: read containment (POSIX-style cwd)", () => {
  const cwd = process.platform === "win32" ? "C:\\work\\repo" : "/work/repo";

  it("keeps reads inside the workspace auto-allowed", () => {
    expect(classifyToolCall("read", { path: "src/a.ts" }, cwd)).toEqual({
      capability: "read",
      paths: ["src/a.ts"],
    });
  });

  it("tags reads outside the workspace path_outside_workspace", () => {
    expect(classifyToolCall("read", { path: "../other/src/a.ts" }, cwd)).toEqual({
      capability: "read",
      paths: ["../other/src/a.ts"],
      riskyClass: "path_outside_workspace",
    });
  });

  it("does not let .. traversal that leaves the repo count as inside", () => {
    expect(classifyToolCall("read", { path: "src/../../escape.txt" }, cwd)).toMatchObject({
      riskyClass: "path_outside_workspace",
    });
    expect(classifyToolCall("read", { path: "src/../README.md" }, cwd)).toEqual({
      capability: "read",
      paths: ["README.md"],
    });
  });

  it.each([
    ".env",
    ".env.local",
    "apps/api/.env.production",
    "certs/server.pem",
    "certs/tls.key",
    "keys/id_rsa",
    "keys/id_ed25519",
    ".npmrc",
    ".netrc",
    "_netrc",
    ".git-credentials",
    "config/credentials",
    "config/credentials.json",
    "deploy/.aws/config",
    "home/.ssh/known_hosts",
  ])("tags secret-looking path %s secret_access even inside the repo", (path) => {
    expect(classifyToolCall("read", { path }, cwd)).toMatchObject({
      capability: "read",
      riskyClass: "secret_access",
    });
  });

  it.each([".env.example", "src/environment.ts", "docs/keys.md", "src/id.ts"])(
    "leaves ordinary path %s alone",
    (path) => {
      expect(classifyToolCall("read", { path }, cwd)).not.toHaveProperty("riskyClass");
    },
  );

  it("prefers secret_access for a secret outside the workspace", () => {
    expect(classifyToolCall("read", { path: "../../home/me/.ssh/id_rsa" }, cwd)).toMatchObject({
      riskyClass: "secret_access",
    });
  });

  it("checks the search root of grep, find and ls", () => {
    for (const tool of ["grep", "find", "ls"]) {
      expect(classifyToolCall(tool, { pattern: "x", path: "../other" }, cwd)).toEqual({
        capability: "read",
        paths: ["../other"],
        riskyClass: "path_outside_workspace",
      });
      expect(classifyToolCall(tool, { pattern: "x", path: "src" }, cwd)).toEqual({
        capability: "read",
        paths: ["src"],
      });
    }
  });

  it("tags a grep whose glob targets secret files secret_access", () => {
    expect(classifyToolCall("grep", { pattern: "KEY", glob: "**/.env*" }, cwd)).toMatchObject({
      riskyClass: "secret_access",
    });
    expect(classifyToolCall("grep", { pattern: "x", glob: "*.ts" }, cwd)).not.toHaveProperty(
      "riskyClass",
    );
  });

  it("tags writes to secret files secret_access too", () => {
    expect(classifyToolCall("write", { path: ".env", content: "X=1" }, cwd)).toEqual({
      capability: "edit_workspace",
      paths: [".env"],
      riskyClass: "secret_access",
    });
  });
});

describe("classifyToolCall: Windows-style paths", () => {
  const cwd = "C:\\Users\\dev\\repo";
  const opts = { pathApi: win32, realpath: (p: string) => p };

  it("treats drive letter and case differences as the same workspace", () => {
    expect(
      classifyToolCall("read", { path: "c:\\users\\DEV\\repo\\src\\a.ts" }, cwd, opts),
    ).toEqual({ capability: "read", paths: ["src/a.ts"] });
    expect(classifyToolCall("read", { path: "src\\b.ts" }, cwd, opts)).toEqual({
      capability: "read",
      paths: ["src/b.ts"],
    });
  });

  it("tags another drive and .. traversal as outside the workspace", () => {
    expect(classifyToolCall("read", { path: "D:\\repo\\src\\a.ts" }, cwd, opts)).toMatchObject({
      riskyClass: "path_outside_workspace",
    });
    expect(classifyToolCall("ls", { path: "..\\other-repo" }, cwd, opts)).toEqual({
      capability: "read",
      paths: ["../other-repo"],
      riskyClass: "path_outside_workspace",
    });
  });

  it("tags user secrets on Windows secret_access", () => {
    for (const path of [
      "C:\\Users\\dev\\.ssh\\id_ed25519",
      "C:\\Users\\dev\\.aws\\credentials",
      "..\\other-repo\\.env",
      "C:\\Users\\dev\\_netrc",
    ]) {
      expect(classifyToolCall("read", { path }, cwd, opts)).toMatchObject({
        riskyClass: "secret_access",
      });
    }
  });
});

describe("classifyToolCall: symlinks", () => {
  let root: string;
  let repo: string;
  let outside: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "blame-links-")));
    repo = join(root, "repo");
    outside = join(root, "outside");
    mkdirSync(join(repo, "src"), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(outside, "notes.txt"), "private");
    writeFileSync(join(repo, "src", "a.ts"), "export {};\n");
    // "junction" lets Windows create a directory link without admin rights; POSIX ignores it.
    symlinkSync(outside, join(repo, "linked"), "junction");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("follows a symlinked directory that points outside the workspace", () => {
    expect(classifyToolCall("read", { path: "linked/notes.txt" }, repo)).toMatchObject({
      capability: "read",
      riskyClass: "path_outside_workspace",
    });
    expect(classifyToolCall("write", { path: "linked/new.txt" }, repo)).toMatchObject({
      riskyClass: "path_outside_workspace",
    });
  });

  it("keeps real files inside the workspace allowed", () => {
    expect(classifyToolCall("read", { path: "src/a.ts" }, repo)).toEqual({
      capability: "read",
      paths: ["src/a.ts"],
    });
  });
});

describe("autonomy gate: reads outside the workspace or of secrets ask in every seed preset", () => {
  const cwd = process.platform === "win32" ? "C:\\work\\repo" : "/work/repo";
  const base: PolicyContext = {
    presetId: "manual",
    earnedLevelId: "L3",
    optedIn: true,
    sandboxAvailable: true,
  };

  it.each(defaultPolicy.presets.map((p) => p.id))(
    "%s asks before risky reads",
    async (presetId) => {
      for (const path of ["../other/.env", ".env", "../other/README.md"]) {
        const approve = vi.fn(async () => false);
        const gate = createAutonomyGate({
          policy: defaultPolicy,
          cwd,
          policyContext: { ...base, presetId },
          approve,
        });
        const result = await gate({ toolName: "read", toolCallId: "r1", input: { path } });
        expect(result?.block).toBe(true);
        expect(approve).toHaveBeenCalledOnce();
      }
    },
  );
});

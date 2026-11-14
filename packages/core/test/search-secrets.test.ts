import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AnyToolDefinition,
  classifyToolCall,
  createSecretSafeSearchTools,
  filterFindOutput,
  filterGrepOutput,
  isSecretPath,
} from "../src/index.js";

// GRA's follow-up to #22: a repo-wide grep, find or ls (no secret path or glob, so no prompt)
// still walked into .env, keys and credential dirs and returned their names and lines.

function byName(list: AnyToolDefinition[]): Record<"grep" | "find" | "ls", AnyToolDefinition> {
  const get = (name: string) => {
    const tool = list.find((t) => t.name === name);
    if (!tool) throw new Error(`missing tool ${name}`);
    return tool;
  };
  return { grep: get("grep"), find: get("find"), ls: get("ls") };
}

function textOf(result: Awaited<ReturnType<AnyToolDefinition["execute"]>>): string {
  return result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
}

const hasBinary = (name: string) => spawnSync(name, ["--version"]).status === 0;

describe("isSecretPath", () => {
  it("treats a credential directory itself as secret, not only files inside it", () => {
    expect(isSecretPath(".ssh")).toBe(true);
    expect(isSecretPath("home/.aws/")).toBe(true);
    expect(isSecretPath(".gnupg")).toBe(true);
    expect(classifyToolCall("ls", { path: ".ssh" }, "/work/repo")).toMatchObject({
      riskyClass: "secret_access",
    });
  });
});

describe("filterGrepOutput", () => {
  it("drops match and context lines from secret files and keeps the rest", () => {
    const raw = [
      "src/a.ts:3: const token = process.env.TOKEN;",
      ".env:1: TOKEN=supersecret",
      "apps/api/.env.local-2- # local",
      "apps/api/.env.local:3: TOKEN=local",
      ".env.example:1: TOKEN=",
      "certs/server.pem:1: TOKEN pem",
      ".ssh/id_rsa:4: TOKEN key",
      "deploy/.aws/credentials:2: TOKEN aws",
      "",
      "[100 matches limit reached. Use limit=200 for more, or refine pattern]",
    ].join("\n");
    const { text, hidden } = filterGrepOutput(raw);
    expect(text).toContain("src/a.ts:3:");
    expect(text).toContain(".env.example:1:");
    expect(text).toContain("[100 matches limit reached");
    expect(text).not.toMatch(/supersecret|TOKEN=local|# local|pem|TOKEN key|TOKEN aws/);
    expect(text).not.toMatch(/(^|\n)\.env:|\.env\.local|server\.pem|id_rsa|credentials/);
    expect(hidden).toBe(6);
  });

  it("fails closed when a path could be parsed more than one way", () => {
    // "dir-2- x/.env:1: v" could be file "dir" (context line 2) or file "dir-2- x/.env" (match).
    expect(filterGrepOutput("dir-2- x/.env:1: v").text).not.toContain("v");
  });

  it("reports no matches when every match came from a secret file", () => {
    expect(filterGrepOutput(".env:1: TOKEN=x").text).toMatch(/^No matches found/);
  });

  it("leaves output alone when nothing is secret", () => {
    expect(filterGrepOutput("src/a.ts:1: x")).toEqual({ text: "src/a.ts:1: x", hidden: 0 });
  });
});

describe("filterFindOutput", () => {
  it("drops secret files and credential dirs, keeps templates and notices", () => {
    const raw = [
      "src/a.ts",
      ".env",
      ".env.example",
      "certs/server.key",
      ".ssh/",
      ".ssh/id_ed25519",
      "config/credentials.json",
      "",
      "[1000 results limit reached]",
    ].join("\n");
    const { text, hidden } = filterFindOutput(raw);
    expect(text.split("\n")).toEqual([
      "src/a.ts",
      ".env.example",
      "",
      "[1000 results limit reached]",
    ]);
    expect(hidden).toBe(5);
  });

  it("reports no files when every result was secret", () => {
    expect(filterFindOutput(".env\n.npmrc").text).toMatch(/^No files found/);
  });
});

describe("secret-safe search tools on a real repo", () => {
  let repo: string;
  const tools = () => byName(createSecretSafeSearchTools(repo));

  beforeAll(() => {
    process.env.PI_OFFLINE = "1"; // never download rg or fd in tests
    repo = realpathSync(mkdtempSync(join(tmpdir(), "blame-search-")));
    mkdirSync(join(repo, "src"));
    mkdirSync(join(repo, "certs"));
    mkdirSync(join(repo, ".ssh"));
    writeFileSync(join(repo, "src", "a.ts"), "const TOKEN = process.env.TOKEN;\n");
    writeFileSync(join(repo, ".env"), "TOKEN=supersecret\n");
    writeFileSync(join(repo, ".env.example"), "TOKEN=\n");
    writeFileSync(join(repo, "certs", "server.pem"), "TOKEN pem\n");
    writeFileSync(join(repo, ".ssh", "id_rsa"), "TOKEN key\n");
    writeFileSync(join(repo, ".npmrc"), "//registry/:_authToken=TOKEN\n");
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("exposes grep, find and ls with Pi's names", () => {
    expect(Object.keys(tools()).sort()).toEqual(["find", "grep", "ls"]);
  });

  it("ls hides secret entries in a repo-wide listing", async () => {
    const out = textOf(await tools().ls.execute("1", {}, undefined, undefined, undefined as never));
    expect(out.split("\n").filter(Boolean)).toEqual([".env.example", "certs/", "src/"]);
  });

  it("ls still lists a secret directory the user explicitly approved", async () => {
    const out = textOf(
      await tools().ls.execute("1", { path: ".ssh" }, undefined, undefined, undefined as never),
    );
    expect(out).toContain("id_rsa");
  });

  it.skipIf(!hasBinary("rg"))("grep never returns secret lines or names", async () => {
    const out = textOf(
      await tools().grep.execute(
        "1",
        { pattern: "TOKEN" },
        undefined,
        undefined,
        undefined as never,
      ),
    );
    expect(out).toContain("src/a.ts:1:");
    expect(out).toContain(".env.example:1:");
    expect(out).not.toMatch(
      /supersecret|TOKEN pem|TOKEN key|_authToken|server\.pem|id_rsa|\.npmrc/,
    );
  });

  it.skipIf(!hasBinary("rg"))(
    "grep still searches a secret file the user explicitly approved",
    async () => {
      const out = textOf(
        await tools().grep.execute(
          "1",
          { pattern: "TOKEN", path: ".env" },
          undefined,
          undefined,
          undefined as never,
        ),
      );
      expect(out).toContain("supersecret");
    },
  );

  it.skipIf(!hasBinary("fd") && !hasBinary("fdfind"))(
    "find never returns secret names",
    async () => {
      const out = textOf(
        await tools().find.execute("1", { pattern: "*" }, undefined, undefined, undefined as never),
      );
      expect(out).toContain("src/a.ts");
      expect(out).not.toMatch(/(^|\n)\.env(\n|$)|server\.pem|id_rsa|\.npmrc/);
    },
  );
});

describe("secret-safe wrappers without rg or fd (stand-in Pi tools)", () => {
  const fake = (name: string, text: string) => ({
    name,
    label: name,
    description: name,
    parameters: {} as never,
    execute: async () => ({ content: [{ type: "text" as const, text }], details: undefined }),
  });
  const tools = byName(
    createSecretSafeSearchTools("/work/repo", {
      definitions: {
        grep: fake("grep", "src/a.ts:1: ok\n.env:1: TOKEN=secret") as never,
        find: fake("find", "src/a.ts\n.env\n.ssh/id_rsa") as never,
      },
    }),
  );
  const run = async (name: "grep" | "find", params: Record<string, unknown>) =>
    textOf(await tools[name].execute("1", params, undefined, undefined, undefined as never));

  it("filters a repo-wide grep and says how many results were hidden", async () => {
    const out = await run("grep", { pattern: "TOKEN" });
    expect(out).toContain("src/a.ts:1: ok");
    expect(out).not.toContain("TOKEN=secret");
    expect(out).toContain("hid 1 result");
  });

  it("filters a repo-wide find", async () => {
    const out = await run("find", { pattern: "**/*" });
    expect(out).toContain("src/a.ts");
    expect(out).not.toMatch(/\.env|id_rsa/);
  });

  it("does not filter when the path or pattern explicitly targets secrets (already asked)", async () => {
    expect(await run("grep", { pattern: "TOKEN", glob: "**/.env*" })).toContain("TOKEN=secret");
    expect(await run("find", { pattern: "**/id_*" })).toContain(".ssh/id_rsa");
  });
});

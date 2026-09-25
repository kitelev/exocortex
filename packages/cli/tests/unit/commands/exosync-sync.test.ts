/**
 * @jest-environment node
 *
 * Unit tests for `exocortex exosync <sync|pull|push>` (EKA M3.7 PA-exosync,
 * RFC 4e4dc453 Phase B CLI parity).
 *
 * Two layers:
 *  1. The NEW node:fs ports the command introduces — writable
 *     `nodeLocalFilesPort`, writable `nodeWatermarkFileIO`,
 *     `nodeMaterializationCheck` — exercised directly against a real temp
 *     dir (this is the genuinely-new code; the engine itself is exhaustively
 *     tested in the exocortex package).
 *  2. `runExosyncSync` wiring end-to-end against the production-shape
 *     `FakeGitHubRepo` (real git blob SHAs, force:false 422 semantics) — a
 *     bootstrap `sync` then a `pull` that must materialise a remote-added
 *     file on disk THROUGH the real writable port, proving port → engine →
 *     disk composition + direction plumbing + exit codes.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { FakeGitHubRepo, mdAsset } from "../../../../core/tests/unit/services/sync/fakeGitHub";
import {
  nodeLocalFilesPort,
  nodeWatermarkFileIO,
  nodeMaterializationCheck,
  nodeLocalBaseShaProvider,
  runExosyncSync,
  type ExosyncSyncOptions,
} from "../../../src/commands/exosync-sync";
import type { SyncRepoSpec } from "@kitelev/exocortex-core";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  REPO_LOCAL_GIT_ENV,
  repoIsolatedGitEnv,
} from "../../../src/utils/repoIsolatedGitEnv";

const ASSET_SPACE_CLASS_UID = "73bd00e4-ccc0-4f3f-b20d-c4388c4588fb";
const OWNER = "test-owner";
const REPO = "test-repo";
const MOUNT = `assetspaces/${OWNER}/${REPO}`;
const FILE_A = "assets/a.md";
const FILE_B = "assets/b.md";
const FAKE_PAT = "ghp_" + "C".repeat(36);

function mkTmp(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

describe("nodeLocalFilesPort (writable)", () => {
  let root: string;
  beforeEach(() => {
    root = mkTmp("exosync-port-");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("writes a file atomically, creating parent directories", async () => {
    const port = nodeLocalFilesPort(root);
    await port.write("nested/deep/x.md", "hello");
    expect(readFileSync(path.join(root, "nested/deep/x.md"), "utf-8")).toBe("hello");
    expect(await port.read("nested/deep/x.md")).toBe("hello");
    // No temp leftover.
    expect(existsSync(path.join(root, "nested/deep/x.md.local.tmp"))).toBe(false);
  });

  it("lists repo-relative forward-slash paths and skips .git", async () => {
    const port = nodeLocalFilesPort(root);
    await port.write("a/b.md", "1");
    await port.write("c.md", "2");
    mkdirSync(path.join(root, ".git"), { recursive: true });
    writeFileSync(path.join(root, ".git", "HEAD"), "ref: x");
    const listed = (await port.list()).sort();
    expect(listed).toEqual(["a/b.md", "c.md"]);
  });

  it("delete is a no-op when the path does not exist", async () => {
    const port = nodeLocalFilesPort(root);
    await expect(port.delete("ghost.md")).resolves.toBeUndefined();
    await port.write("real.md", "x");
    await port.delete("real.md");
    expect(existsSync(path.join(root, "real.md"))).toBe(false);
  });

  it("round-trips binary content through writeBinary/readBinary", async () => {
    const port = nodeLocalFilesPort(root);
    const bytes = new Uint8Array([0, 1, 2, 255, 254]);
    await port.writeBinary!("blob.bin", bytes);
    expect([...(await port.readBinary!("blob.bin"))]).toEqual([...bytes]);
  });
});

describe("nodeWatermarkFileIO", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkTmp("exosync-wm-");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns null when the watermark file is absent", async () => {
    const io = nodeWatermarkFileIO(path.join(dir, "sub", "wm.json"));
    expect(await io.read()).toBeNull();
  });

  it("writes atomically (creating parents) and round-trips", async () => {
    const file = path.join(dir, "plugins", "exocortex", "wm.json");
    const io = nodeWatermarkFileIO(file);
    await io.writeAtomic('{"version":1}');
    expect(await io.read()).toBe('{"version":1}');
    expect(existsSync(`${file}.local.tmp`)).toBe(false);
  });
});

describe("nodeMaterializationCheck", () => {
  let vault: string;
  beforeEach(() => {
    vault = mkTmp("exosync-mat-");
  });
  afterEach(() => rmSync(vault, { recursive: true, force: true }));

  const spec = (localPath: string, kind?: "asset" | "file"): SyncRepoSpec => ({
    owner: OWNER,
    repo: REPO,
    branch: "main",
    repoKey: `${OWNER}/${REPO}#main`,
    localPath,
    ...(kind === "file" ? { spaceKind: kind } : {}),
  });

  it("flags a missing mount folder as not materialized", async () => {
    const check = nodeMaterializationCheck(vault);
    const r = await check.check(spec("assetspaces/x/y"));
    expect(r.fullyMaterialized).toBe(false);
    expect(r.reason).toMatch(/does not exist/);
  });

  it("flags an empty non-file mount folder as not materialized", async () => {
    mkdirSync(path.join(vault, MOUNT), { recursive: true });
    const r = await nodeMaterializationCheck(vault).check(spec(MOUNT));
    expect(r.fullyMaterialized).toBe(false);
    expect(r.reason).toMatch(/empty/);
  });

  it("accepts a non-empty mount folder", async () => {
    mkdirSync(path.join(vault, MOUNT), { recursive: true });
    writeFileSync(path.join(vault, MOUNT, "a.md"), "x");
    const r = await nodeMaterializationCheck(vault).check(spec(MOUNT));
    expect(r.fullyMaterialized).toBe(true);
  });

  it("accepts an empty FileSpace folder (legitimate first-sync state)", async () => {
    mkdirSync(path.join(vault, MOUNT), { recursive: true });
    const r = await nodeMaterializationCheck(vault).check(spec(MOUNT, "file"));
    expect(r.fullyMaterialized).toBe(true);
  });
});

/** Build a temp vault with one materialized AssetSpace declaration + mount. */
function makeVault(mountFiles: Record<string, string>): {
  vault: string;
  cleanup: () => void;
} {
  const vault = mkTmp("exosync-sync-test-");
  writeFileSync(
    path.join(vault, "space-decl.md"),
    `---\nexo__Asset_uid: decl-uid\nexo__Instance_class:\n  - "[[${ASSET_SPACE_CLASS_UID}]]"\nexo__AssetSpace_source: https://github.com/${OWNER}/${REPO}\n---\n\nDeclaration\n`,
  );
  for (const [rel, content] of Object.entries(mountFiles)) {
    const full = path.join(vault, MOUNT, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return { vault, cleanup: () => rmSync(vault, { recursive: true, force: true }) };
}

describe("runExosyncSync — wiring", () => {
  it("returns 2 (vacuous) when no materialized AssetSpaces are present", async () => {
    const vault = mkTmp("exosync-empty-");
    const lines: string[] = [];
    try {
      const code = await runExosyncSync(
        "sync",
        { vault, token: FAKE_PAT },
        { out: (l) => lines.push(l), env: {} },
      );
      expect(code).toBe(2);
      expect(lines.join("\n")).toMatch(/Nothing to sync/);
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  it("throws when no token is available", async () => {
    const fx = makeVault({ [FILE_A]: mdAsset("u1") });
    try {
      await expect(
        runExosyncSync("sync", { vault: fx.vault }, { env: {} }),
      ).rejects.toThrow(/GitHub token is required/);
    } finally {
      fx.cleanup();
    }
  });

  // #4225 — a push-only run defers an incoming change under a pin; the Summary
  // line must say so, and a pull must clear it.
  it("W1 @req:c0b0e8bf-355d-4b03-9512-618c879f0940 push leaves a deferred incoming change pinned and the Summary line counts it; pull clears it", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const fx = makeVault({ [FILE_A]: mdAsset("u1") });
    const run = async (direction: "sync" | "push" | "pull"): Promise<string> => {
      const lines: string[] = [];
      const code = await runExosyncSync(
        direction,
        { vault: fx.vault, token: FAKE_PAT },
        { transportFactory: () => gh.transport(), out: (l: string) => lines.push(l), env: {} },
      );
      expect(code).toBe(0);
      return lines.find((l) => l.startsWith("Summary:")) ?? "";
    };
    try {
      expect(await run("sync")).not.toMatch(/pinned/);
      gh.commitDirect("main", { [FILE_B]: mdAsset("u2", "remote add") }, "device B");
      expect(await run("push")).toMatch(/, pinned 1 \(see `exosync quarantine list`\)$/);
      expect(await run("pull")).not.toMatch(/pinned/);
    } finally {
      fx.cleanup();
    }
  });

  it("pull materialises a remote-added file on disk (port → engine → disk)", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const fx = makeVault({ [FILE_A]: mdAsset("u1") });
    const out = (over: Partial<ExosyncSyncOptions> = {}) => ({
      transportFactory: () => gh.transport(),
      out: () => {},
      env: {},
      ...over,
    });
    try {
      // Bootstrap: local == remote → clean adopt, watermark established.
      const bootstrap = await runExosyncSync(
        "sync",
        { vault: fx.vault, token: FAKE_PAT },
        out(),
      );
      expect(bootstrap).toBe(0);
      const wmPath = path.join(
        fx.vault,
        ".obsidian",
        "plugins",
        "exocortex",
        "exosync-watermarks.local.json",
      );
      expect(existsSync(wmPath)).toBe(true);

      // Device B adds FILE_B on the remote.
      gh.commitDirect("main", { [FILE_B]: mdAsset("u2", "remote add") }, "device B");
      expect(existsSync(path.join(fx.vault, MOUNT, FILE_B))).toBe(false);

      // Pull applies it to disk through the real node:fs writable port.
      const lines: string[] = [];
      const pull = await runExosyncSync(
        "pull",
        { vault: fx.vault, token: FAKE_PAT },
        out({ out: (l: string) => lines.push(l) }),
      );
      expect(pull).toBe(0);
      const pulledPath = path.join(fx.vault, MOUNT, FILE_B);
      expect(existsSync(pulledPath)).toBe(true);
      expect(readFileSync(pulledPath, "utf-8")).toBe(mdAsset("u2", "remote add"));
      expect(lines.join("\n")).toMatch(/pulled 1/);
      // Pull pushes nothing — the remote head did not move further.
      expect(gh.headFiles().has(FILE_B)).toBe(true);
    } finally {
      fx.cleanup();
    }
  });
});

// #3590 FULL fix — the CLI backfill source: the genuine 3-way base for a repo
// mounted before the mount layer recorded one is the submodule's checked-out
// HEAD. Real git fixture (test-fixture-realism — not a mock): a desktop vault
// with a real submodule must yield the checked-out commit; non-submodule / not-
// a-git-repo / hostile paths must degrade to null (engine then full-conflicts).
describe("nodeLocalBaseShaProvider (#3590 base backfill source)", () => {
  let workdir: string;
  beforeEach(() => {
    workdir = mkTmp("exosync-backfill-");
  });
  afterEach(() => rmSync(workdir, { recursive: true, force: true }));

  function git(cwd: string, args: string[]): string {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t.io",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t.io",
      },
    }).trim();
  }

  function spec(localPath: string): SyncRepoSpec {
    return {
      owner: OWNER,
      repo: REPO,
      branch: "main",
      repoKey: `${OWNER}/${REPO}#main`,
      localPath,
    };
  }

  it("returns the submodule's checked-out HEAD SHA (real git submodule)", async () => {
    // 'remote' repo with one commit — the genuine mount base.
    const remote = path.join(workdir, "remote");
    mkdirSync(remote);
    git(remote, ["init", "-q", "-b", "main"]);
    writeFileSync(path.join(remote, "a.md"), "x");
    git(remote, ["add", "-A"]);
    git(remote, ["commit", "-q", "-m", "init"]);
    const remoteHead = git(remote, ["rev-parse", "HEAD"]);

    // 'vault' superproject with the remote added as a submodule.
    const vault = path.join(workdir, "vault");
    mkdirSync(vault);
    git(vault, ["init", "-q", "-b", "main"]);
    git(vault, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      `file://${remote}`,
      "assetspaces/o/r",
    ]);

    const sha = await nodeLocalBaseShaProvider(vault)(spec("assetspaces/o/r"));
    expect(sha).toBe(remoteHead);
    // Seven top-level `git` runs (6 in the fixture + the provider's
    // `submodule status`), one of them a file:// clone via `submodule add`.
    // The 5 s default is a speed budget this test never
    // meant to assert; under a loaded pre-commit hook it timed out while the
    // provider itself was correct (2026-09-25, load average 40-99).
  }, 30_000);

  it("returns null for a path that is NOT a submodule", async () => {
    const vault = path.join(workdir, "plain");
    mkdirSync(vault);
    git(vault, ["init", "-q", "-b", "main"]);
    expect(
      await nodeLocalBaseShaProvider(vault)(spec("assetspaces/o/r")),
    ).toBeNull();
  }, 30_000); // real git subprocesses — see the budget note on the case above

  it("returns null when the vault is not a git repo (git unavailable analogue)", async () => {
    const notGit = path.join(workdir, "notgit");
    mkdirSync(notGit);
    expect(
      await nodeLocalBaseShaProvider(notGit)(spec("assetspaces/o/r")),
    ).toBeNull();
  }, 30_000); // real git subprocesses — see the budget note on the case above

  // Req 91b2c01a. Inside ANOTHER repository's git hook, git exports that
  // repository's GIT_DIR / GIT_INDEX_FILE. `-C <vault>` only moves the working
  // directory, so an inheriting `git submodule status` reads the decoy and the
  // provider returns null (full-conflict fallback for a space whose base is
  // known). The provider must answer from the vault and leave the decoy alone.
  // The variables go into THIS sandbox's process.env — the object the provider
  // reads — and only around the provider call (the fixture's own git runs need
  // a clean env).
  it("H1 @req:91b2c01a-0c61-4ee1-a41e-dc465c84eae1 reads the vault's submodule even under another repository's hook env (decoy untouched)", async () => {
    const remote = path.join(workdir, "remote");
    mkdirSync(remote);
    git(remote, ["init", "-q", "-b", "main"]);
    writeFileSync(path.join(remote, "a.md"), "x");
    git(remote, ["add", "-A"]);
    git(remote, ["commit", "-q", "-m", "init"]);
    const remoteHead = git(remote, ["rev-parse", "HEAD"]);

    const vault = path.join(workdir, "vault");
    mkdirSync(vault);
    git(vault, ["init", "-q", "-b", "main"]);
    git(vault, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      `file://${remote}`,
      "assetspaces/o/r",
    ]);

    const decoy = path.join(workdir, "decoy");
    mkdirSync(decoy);
    git(decoy, ["init", "-q", "-b", "main"]);
    writeFileSync(path.join(decoy, "d.md"), "d");
    git(decoy, ["add", "-A"]);
    git(decoy, ["commit", "-q", "-m", "decoy"]);
    const decoyHead = git(decoy, ["rev-parse", "HEAD"]);
    const decoyIndex = readFileSync(path.join(decoy, ".git", "index"));

    const saved = { dir: process.env.GIT_DIR, index: process.env.GIT_INDEX_FILE };
    process.env.GIT_DIR = path.join(decoy, ".git");
    process.env.GIT_INDEX_FILE = path.join(decoy, ".git", "index");
    let sha: string | null;
    try {
      sha = await nodeLocalBaseShaProvider(vault)(spec("assetspaces/o/r"));
    } finally {
      if (saved.dir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved.dir;
      if (saved.index === undefined) delete process.env.GIT_INDEX_FILE;
      else process.env.GIT_INDEX_FILE = saved.index;
    }

    expect(sha).toBe(remoteHead);
    expect(git(decoy, ["rev-parse", "HEAD"])).toBe(decoyHead);
    expect(readFileSync(path.join(decoy, ".git", "index")).equals(decoyIndex)).toBe(true);
  }, 30_000); // real git subprocesses — see the budget note on the first case

  it("refuses a leading-dash localPath (never lets git misread it as an option)", async () => {
    expect(await nodeLocalBaseShaProvider(workdir)(spec("--upload-pack=x"))).toBeNull();
    expect(await nodeLocalBaseShaProvider(workdir)(spec(""))).toBeNull();
  });
});

// Req 91b2c01a, the population half. The population is every file in
// packages/cli/src that imports child_process (not every call the regex happens
// to recognise), and each one is classified: it strips git's repository-local
// variables, it inherits them on purpose for a NAMED call, or it spawns no git.
// A new spawner fails the scan until someone classifies it.
describe("CLI git calls are isolated from the enclosing repository's env (req 91b2c01a)", () => {
  const CLI_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../src");

  type Rule =
    | { kind: "strips" }
    | { kind: "inherits"; call: string; reason: string }
    | { kind: "no-git"; spawns: string };
  const SPAWNERS: Record<string, Rule> = {
    "commands/exosync-sync.ts": { kind: "strips" },
    "commands/validate-schema.ts": {
      kind: "inherits",
      call: "git diff --cached",
      reason:
        "getStagedMdFiles: `git diff --cached` from the vault's own pre-commit must read the index being committed (a partial commit's temporary GIT_INDEX_FILE)",
    },
    "mcp/cliRunner.ts": { kind: "no-git", spawns: "the exocortex CLI itself" },
    "services/RestPushService.ts": { kind: "no-git", spawns: "gh auth token" },
    "services/SpawnService.ts": { kind: "no-git", spawns: "tmux" },
  };

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return sourceFiles(full);
      return /\.(ts|js|mjs|cjs)$/.test(e.name) ? [full] : [];
    });
  }

  // Comments blanked to spaces (offsets kept), strings left intact, so a helper
  // name that survives only in a comment does not count.
  function withoutComments(src: string): string {
    let out = "";
    let quote: string | null = null;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        out += c;
        if (c === "\\") { out += src[i + 1] ?? ""; i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { quote = c; out += c; continue; }
      if (c === "/" && src[i + 1] === "/") {
        while (i < src.length && src[i] !== "\n") { out += " "; i++; }
        out += src[i] ?? "";
        continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        const end = src.indexOf("*/", i + 2);
        const stop = end === -1 ? src.length : end + 2;
        for (; i < stop; i++) out += src[i] === "\n" ? "\n" : " ";
        i--;
        continue;
      }
      out += c;
    }
    return out;
  }

  // The text of a call from its opening parenthesis to the matching close.
  function callText(src: string, openParen: number): string {
    let depth = 0;
    for (let i = openParen; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")" && --depth === 0) return src.slice(openParen, i + 1);
    }
    return src.slice(openParen);
  }

  const IMPORTS_CHILD_PROCESS = /(?:\bfrom|\brequire\(|\bimport\()\s*["'`](?:node:)?child_process["'`]/;
  // A string that IS "git" or starts with "git " — as a call's first argument or anywhere.
  const GIT_LITERAL = /["'`]git(?=["'`\s])/g;

  function scan(): { file: string; problems: string[] }[] {
    return sourceFiles(CLI_SRC)
      .filter((f) => IMPORTS_CHILD_PROCESS.test(readFileSync(f, "utf-8")))
      .map((f) => {
        const file = path.relative(CLI_SRC, f);
        const src = withoutComments(readFileSync(f, "utf-8"));
        const rule = SPAWNERS[file];
        const problems: string[] = [];
        if (!rule) problems.push("imports child_process but is not classified in SPAWNERS");
        const literals = [...src.matchAll(GIT_LITERAL)].map((m) => m.index ?? 0);
        if (rule?.kind === "strips" && literals.length === 0) {
          problems.push("classified `strips` but runs no git (stale entry?)");
        }
        for (const at of literals) {
          const open = src.lastIndexOf("(", at);
          const isFirstArg = open !== -1 && /^\(\s*$/.test(src.slice(open, at));
          const call = isFirstArg ? callText(src, open) : "";
          const where = `${file}: ${src.slice(at, at + 40).replace(/\s+/g, " ")}`;
          if (!isFirstArg) {
            problems.push(`git literal outside a call's first argument (constant or alias?) — ${where}`);
          } else if (rule?.kind === "no-git") {
            problems.push(`classified no-git (spawns ${rule.spawns}) but calls git — ${where}`);
          } else if (rule?.kind === "inherits" && call.includes(rule.call)) {
            // the one named call that inherits on purpose
          } else if (!/\benv\s*:\s*repoIsolatedGitEnv\(/.test(call)) {
            problems.push(`git call without env: repoIsolatedGitEnv(...) — ${where}`);
          }
        }
        if (rule?.kind === "inherits" && !literals.some((at) => src.slice(at + 1).startsWith(rule.call))) {
          problems.push(`allow-listed call «${rule.call}» no longer exists (stale entry)`);
        }
        return { file, problems };
      });
  }

  it("H2 every child_process importer in packages/cli/src is classified, and every git call strips repository-local env or is the one named inheritor", () => {
    const result = scan();
    // Canary: the population is what the table says, no more, no less.
    expect(result.map((r) => r.file).sort()).toEqual(Object.keys(SPAWNERS).sort());
    expect(result.flatMap((r) => r.problems)).toEqual([]);
  });

  it("H3 the stripped list is git's own --local-env-vars minus the two config channels, and a subset of the jest globalSetup twin", () => {
    const CONFIG_CHANNELS = ["GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT"];
    const own = execFileSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf-8" })
      .split("\n")
      .map((v) => v.trim())
      .filter(Boolean);
    expect(own.length).toBeGreaterThan(0);
    expect([...REPO_LOCAL_GIT_ENV]).toEqual(
      expect.arrayContaining(own.filter((v) => !CONFIG_CHANNELS.includes(v))),
    );
    expect(REPO_LOCAL_GIT_ENV.filter((v) => CONFIG_CHANNELS.includes(v))).toEqual([]);

    const twin = createRequire(import.meta.url)(
      path.resolve(CLI_SRC, "../../test-utils/src/jest/stripRepoGitEnv.cjs"),
    ) as { REPO_LOCAL_GIT_ENV: string[] };
    expect(twin.REPO_LOCAL_GIT_ENV).toEqual(expect.arrayContaining([...REPO_LOCAL_GIT_ENV]));
  });

  // The reviewer's regression on #4388: env-provided config (safe.directory in a
  // container) must still reach git. Real git reads it back.
  it("H4 config given through the environment survives the helper and reaches git", () => {
    const dir = mkTmp("gitenv-config-");
    try {
      const env = repoIsolatedGitEnv({
        ...process.env,
        GIT_DIR: path.join(dir, "no-such-repo"),
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "probe.fromenv",
        GIT_CONFIG_VALUE_0: "kept",
        GIT_CONFIG_PARAMETERS: "'probe.fromc'='kept-too'",
      });
      expect(env.GIT_DIR).toBeUndefined();
      const get = (key: string) =>
        execFileSync("git", ["config", "--get", key], { cwd: dir, env, encoding: "utf-8" }).trim();
      expect(get("probe.fromenv")).toBe("kept");
      expect(get("probe.fromc")).toBe("kept-too");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Every package's jest config must strip the ENCLOSING repository's git
 * environment before any worker starts.
 *
 * Inside a git hook (pre-commit → lint-staged → jest --findRelatedTests) git
 * exports GIT_DIR / GIT_INDEX_FILE / … for the repository being committed. A
 * test that spawns `git init` / `add -A` / `commit` in a temp dir with the
 * inherited environment then operates on THAT repository. Observed 2026-09-25
 * (PR #4371): a cli test committed "delete all 2540 files" onto the
 * developer's branch and wedged lint-staged's restore.
 *
 * The shared jest globalSetup `packages/test-utils/src/jest/stripRepoGitEnv.cjs`
 * deletes git's own repo-local variable list in the jest PARENT process, so
 * workers — and every `git` spawned without an explicit `env` — inherit a clean
 * environment.
 *
 *  G1 wiring: every packages/<pkg>/jest.config.js (enumerated, not listed)
 *     declares that globalSetup.
 *  G2 the module deletes each listed variable and nothing else.
 *  G3 end to end: in a process whose GIT_DIR points at a decoy repo, git run
 *     after the setup finds its own temp repo; without the setup it finds the
 *     decoy (control — the hazard is real, not assumed).
 *
 * The decoy is always a temp repo; the working repository is never pointed at.
 */
import { describe, it, expect } from "@jest/globals";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const repoRoot = path.resolve(__dirname, "../../../../..");
const SHARED = path.join(repoRoot, "packages/test-utils/src/jest/stripRepoGitEnv.cjs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const stripRepoGitEnv = require(SHARED) as ((env?: NodeJS.ProcessEnv) => Promise<void>) & {
  REPO_LOCAL_GIT_ENV: string[];
};

function jestConfigs(): string[] {
  const pkgs = path.join(repoRoot, "packages");
  return fs
    .readdirSync(pkgs)
    .map((d) => path.join(pkgs, d, "jest.config.js"))
    .filter((f) => fs.existsSync(f));
}

function tmpGitRepo(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  execFileSync("git", ["init", "-q", dir], { env: cleanEnv() });
  return dir;
}

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of stripRepoGitEnv.REPO_LOCAL_GIT_ENV) delete env[name];
  return env;
}

describe("hook-safe git environment for every jest config", () => {
  it("G1 every packages/*/jest.config.js declares the shared stripRepoGitEnv globalSetup", () => {
    const configs = jestConfigs();
    // Canary: the enumeration must see the packages that run real git in tests.
    expect(configs.map((c) => path.basename(path.dirname(c)))).toEqual(
      expect.arrayContaining(["cli", "obsidian-plugin", "core"]),
    );
    const offenders = configs.filter((cfgPath) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cfg = require(cfgPath) as { globalSetup?: string; rootDir?: string };
      if (typeof cfg.globalSetup !== "string") return true;
      const rootDir = path.resolve(path.dirname(cfgPath), cfg.rootDir ?? ".");
      return path.resolve(cfg.globalSetup.replace("<rootDir>", rootDir)) !== SHARED;
    });
    expect(offenders.map((c) => path.relative(repoRoot, c))).toEqual([]);
  });

  it("G2 the setup deletes every repo-local git variable and leaves the rest", async () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin", GIT_TERMINAL_PROMPT: "0" };
    for (const name of stripRepoGitEnv.REPO_LOCAL_GIT_ENV) env[name] = "/decoy";
    await stripRepoGitEnv(env);
    expect(stripRepoGitEnv.REPO_LOCAL_GIT_ENV).toEqual(
      expect.arrayContaining(["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_COMMON_DIR"]),
    );
    expect(Object.keys(env).sort()).toEqual(["GIT_TERMINAL_PROMPT", "PATH"]);
  });

  it("G3 after the setup a spawned git finds its own repo, not the decoy the env points at", () => {
    const decoy = tmpGitRepo("hook-env-decoy-");
    const own = tmpGitRepo("hook-env-own-");
    const probe = (runSetup: boolean) =>
      execFileSync(
        process.execPath,
        [
          "-e",
          `const s = require(${JSON.stringify(SHARED)});
           (async () => {
             if (${runSetup}) await s();
             const r = require("child_process").execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: ${JSON.stringify(own)}, encoding: "utf8" });
             process.stdout.write(r.trim());
           })();`,
        ],
        {
          encoding: "utf8",
          env: { ...cleanEnv(), GIT_DIR: path.join(decoy, ".git"), GIT_INDEX_FILE: path.join(decoy, ".git", "index") },
        },
      );
    try {
      expect(probe(false)).toBe(path.join(decoy, ".git")); // control: the hazard is real
      expect(probe(true)).toBe(path.join(own, ".git"));
    } finally {
      fs.rmSync(decoy, { recursive: true, force: true });
      fs.rmSync(own, { recursive: true, force: true });
    }
  });
});

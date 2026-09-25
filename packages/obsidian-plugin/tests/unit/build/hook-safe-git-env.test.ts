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
 *  G1 wiring: every jest config in the tree (any directory outside
 *     node_modules / .git / dist / coverage, any jest[.<name>].config.[c|m][j|t]s)
 *     declares that globalSetup, and no package.json carries an inline "jest"
 *     config object. A filesystem walk, not `git ls-files`: the axis must also
 *     hold in a mutant-driver copy of the tree, which has no .git.
 *  G2 the helper deletes each listed variable and nothing else; the list is
 *     pinned name by name and covers `git rev-parse --local-env-vars`.
 *  G3 end to end: in a process whose GIT_DIR points at a decoy repo, git run
 *     after the setup — invoked with jest's (globalConfig, projectConfig)
 *     arguments — finds its own temp repo; without the setup it finds the
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
const stripRepoGitEnv = require(SHARED) as ((...jestArgs: unknown[]) => Promise<void>) & {
  stripFrom: (env: NodeJS.ProcessEnv) => void;
  REPO_LOCAL_GIT_ENV: string[];
};

const JEST_CONFIG_RE = /(^|\/)jest(\.[^/]+)?\.config\.[cm]?[jt]s$/;

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out);
    } else if (e.isFile()) {
      out.push(path.relative(repoRoot, path.join(dir, e.name)));
    }
  }
  return out;
}

function jestConfigs(files: string[]): string[] {
  return files.filter((p) => JEST_CONFIG_RE.test(p)).map((p) => path.join(repoRoot, p));
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
  it("G1 every tracked jest config declares the shared stripRepoGitEnv globalSetup", () => {
    const files = walk(repoRoot);
    const configs = jestConfigs(files);
    // Canary: the enumeration must see the packages that run real git in tests,
    // and the non-default-named UI config.
    expect(configs.map((c) => path.relative(repoRoot, c))).toEqual(
      expect.arrayContaining([
        "packages/cli/jest.config.js",
        "packages/core/jest.config.js",
        "packages/obsidian-plugin/jest.config.js",
        "packages/obsidian-plugin/jest.ui.config.js",
      ]),
    );
    const inlineJestConfig = files
      .filter((p) => path.basename(p) === "package.json")
      .filter((p) => {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, p), "utf8")) as { jest?: unknown };
        return typeof pkg.jest === "object" && pkg.jest !== null;
      });
    expect(inlineJestConfig).toEqual([]);
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
    stripRepoGitEnv.stripFrom(env);
    expect(Object.keys(env).sort()).toEqual(["GIT_TERMINAL_PROMPT", "PATH"]);
    // Pinned name by name — a list built from itself cannot notice a dropped entry.
    expect([...stripRepoGitEnv.REPO_LOCAL_GIT_ENV].sort()).toEqual([
      "GIT_ALTERNATE_OBJECT_DIRECTORIES",
      "GIT_COMMON_DIR",
      "GIT_CONFIG",
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_PARAMETERS",
      "GIT_DIR",
      "GIT_GRAFT_FILE",
      "GIT_IMPLICIT_WORK_TREE",
      "GIT_INDEX_FILE",
      "GIT_INTERNAL_SUPER_PREFIX",
      "GIT_NO_REPLACE_OBJECTS",
      "GIT_OBJECT_DIRECTORY",
      "GIT_PREFIX",
      "GIT_REPLACE_REF_BASE",
      "GIT_SHALLOW_FILE",
      "GIT_WORK_TREE",
    ]);
    // …and it must cover what the installed git itself calls repo-local.
    const fromGit = execFileSync("git", ["rev-parse", "--local-env-vars"], {
      encoding: "utf8",
      env: cleanEnv(),
    })
      .split("\n")
      .filter(Boolean);
    expect(fromGit.length).toBeGreaterThan(0);
    expect(stripRepoGitEnv.REPO_LOCAL_GIT_ENV).toEqual(expect.arrayContaining(fromGit));
  });

  it("G3 after the setup a spawned git finds its own repo, not the decoy the env points at", () => {
    let decoy: string | undefined;
    let own: string | undefined;
    const probe = (runSetup: boolean, d: string, o: string) =>
      execFileSync(
        process.execPath,
        [
          "-e",
          `const s = require(${JSON.stringify(SHARED)});
           (async () => {
             // Called exactly as jest calls a globalSetup: (globalConfig, projectConfig).
             if (${runSetup}) await s({ rootDir: "/g" }, { rootDir: "/p" });
             const r = require("child_process").execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: ${JSON.stringify(o)}, encoding: "utf8" });
             process.stdout.write(r.trim());
           })();`,
        ],
        {
          encoding: "utf8",
          env: { ...cleanEnv(), GIT_DIR: path.join(d, ".git"), GIT_INDEX_FILE: path.join(d, ".git", "index") },
        },
      );
    try {
      decoy = tmpGitRepo("hook-env-decoy-");
      own = tmpGitRepo("hook-env-own-");
      expect(probe(false, decoy, own)).toBe(path.join(decoy, ".git")); // control: the hazard is real
      expect(probe(true, decoy, own)).toBe(path.join(own, ".git"));
    } finally {
      if (decoy) fs.rmSync(decoy, { recursive: true, force: true });
      if (own) fs.rmSync(own, { recursive: true, force: true });
    }
  });
});

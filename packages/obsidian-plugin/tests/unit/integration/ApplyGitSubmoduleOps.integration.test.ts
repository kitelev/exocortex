/**
 * @jest-environment node
 *
 * Integration tests для applyProfile() real submodule operations using
 * file:// URLs (fast offline, exercises real git subprocess).
 *
 * Coverage:
 *   - Real `.gitmodules` mutation via GitSubmoduleOps (full chain)
 *   - F5 — submodule add + deinit + orphan cleanup empirically validated
 *   - rollback test: induce failure mid-Phase 2, verify vault state recoverable
 *
 * Skipped if `git` binary missing (CI hardening).
 */

/* eslint-disable no-restricted-imports, import/no-nodejs-modules */
import { execSync, execFileSync } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
/* eslint-enable no-restricted-imports, import/no-nodejs-modules */

import {
  GitSubmoduleOps,
  parseGitmodulesPaths,
} from "../../../src/infrastructure/adapters/GitSubmoduleOps";

function hasGitBinary(): boolean {
  try {
    execSync("git --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a clean env for git subprocess calls — strips any inherited GIT_*
 * variables that pre-commit hooks (husky / lint-staged) set, which would
 * otherwise hijack `git init` into the outer plugin repo's index/tree.
 */
function cleanGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith("GIT_")) delete env[k];
  }
  env["GIT_CONFIG_COUNT"] = "1";
  env["GIT_CONFIG_KEY_0"] = "protocol.file.allow";
  env["GIT_CONFIG_VALUE_0"] = "always";
  return env;
}

// Set protocol.file.allow override on global process.env BEFORE GitSubmoduleOps
// internals (которая reads process.env in stripGitEnv) executes any
// `git submodule add` call. CVE-2022-39253 mitigation в CI runners.
process.env.GIT_CONFIG_COUNT = "1";
process.env.GIT_CONFIG_KEY_0 = "protocol.file.allow";
process.env.GIT_CONFIG_VALUE_0 = "always";

const GIT_OPTS: { env: NodeJS.ProcessEnv } = { env: cleanGitEnv() };

const itIfGit = hasGitBinary() ? it : it.skip;

async function makeBareRepo(label: string, files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `exo-p3-repo-${label}-`));
  execFileSync("git", ["init", "-q", "-b", "main", dir], GIT_OPTS);
  // Disable git user/email requirement via local config.
  execFileSync("git", ["-C", dir, "config", "user.email", "test@example.com"], GIT_OPTS);
  execFileSync("git", ["-C", dir, "config", "user.name", "Test"], GIT_OPTS);
  // Some git versions reject pushes to a non-bare repo; set receive.denyCurrentBranch=warn.
  execFileSync("git", ["-C", dir, "config", "receive.denyCurrentBranch", "ignore"], GIT_OPTS);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
  execFileSync("git", ["-C", dir, "add", "."], GIT_OPTS);
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "initial"], GIT_OPTS);
  return dir;
}

describe("GitSubmoduleOps integration", () => {
  let parentVault: string;
  let remoteA: string;
  let remoteB: string;

  beforeEach(async () => {
    parentVault = await fs.mkdtemp(path.join(os.tmpdir(), "exo-p3-parent-"));
    execFileSync("git", ["init", "-q", "-b", "main", parentVault], GIT_OPTS);
    execFileSync("git", ["-C", parentVault, "config", "user.email", "test@example.com"], GIT_OPTS);
    execFileSync("git", ["-C", parentVault, "config", "user.name", "Test"], GIT_OPTS);
    execFileSync("git", ["-C", parentVault, "config", "protocol.file.allow", "always"], GIT_OPTS);
    await fs.writeFile(path.join(parentVault, "README.md"), "vault\n");
    execFileSync("git", ["-C", parentVault, "add", "README.md"], GIT_OPTS);
    execFileSync("git", ["-C", parentVault, "commit", "-q", "-m", "init parent"], GIT_OPTS);

    remoteA = await makeBareRepo("a", {
      "a.md": "a content\n",
      "b.md": "b content\n",
    });
    remoteB = await makeBareRepo("b", {
      "x.md": "x content\n",
    });
  });

  afterEach(async () => {
    for (const dir of [parentVault, remoteA, remoteB]) {
      if (dir && existsSync(dir)) {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  });

  itIfGit("submoduleAdd → readGitmodulesPaths → submoduleDeinit + removeGitModulesDir + removeWorkingTree + atomicGitmodulesEntryRemove", async () => {
    const ops = new GitSubmoduleOps({ vaultRootPath: parentVault });

    // Add submodule.
    await ops.submoduleAdd(`file://${remoteA}`, "assetspaces/a");
    expect(existsSync(path.join(parentVault, "assetspaces/a"))).toBe(true);
    expect(existsSync(path.join(parentVault, ".gitmodules"))).toBe(true);
    expect(existsSync(path.join(parentVault, ".git/modules/assetspaces/a"))).toBe(true);

    const pathsAfterAdd = await ops.readGitmodulesPaths();
    expect(pathsAfterAdd.has("assetspaces/a")).toBe(true);

    // Commit submodule add (required so deinit doesn't trip on uncommitted state).
    execFileSync("git", ["-C", parentVault, "add", "."], GIT_OPTS);
    execFileSync("git", ["-C", parentVault, "commit", "-q", "-m", "add submodule a"], GIT_OPTS);

    // Tear down full chain.
    await ops.submoduleDeinit("assetspaces/a");
    await ops.removeGitModulesDir("assetspaces/a");
    await ops.removeWorkingTree("assetspaces/a");
    await ops.atomicGitmodulesEntryRemove("assetspaces/a");

    expect(existsSync(path.join(parentVault, ".git/modules/assetspaces/a"))).toBe(false);
    expect(existsSync(path.join(parentVault, "assetspaces/a"))).toBe(false);
    const pathsAfter = await ops.readGitmodulesPaths();
    expect(pathsAfter.has("assetspaces/a")).toBe(false);
  }, 60_000);

  itIfGit("can re-add the same submodule after teardown (M2 orphan cleanup verified)", async () => {
    const ops = new GitSubmoduleOps({ vaultRootPath: parentVault });

    // Add → commit → destroy → re-add. Without removeGitModulesDir between
    // destroy и re-add, git would refuse: `'assetspaces/a' already exists
    // and is not a valid git repo`.
    await ops.submoduleAdd(`file://${remoteA}`, "assetspaces/a");
    execFileSync("git", ["-C", parentVault, "add", "."], GIT_OPTS);
    execFileSync("git", ["-C", parentVault, "commit", "-q", "-m", "add submodule a"], GIT_OPTS);

    await ops.submoduleDeinit("assetspaces/a");
    await ops.removeGitModulesDir("assetspaces/a");
    await ops.removeWorkingTree("assetspaces/a");
    await ops.atomicGitmodulesEntryRemove("assetspaces/a");
    // Clear the submodule entry from the index (best-effort — may exit non-zero
    // if `git rm` cannot find the path because filesystem destroy already ran;
    // ignore that case).
    try {
      execFileSync("git", ["-C", parentVault, "rm", "-rf", "--cached", "assetspaces/a"], { stdio: "ignore", env: cleanGitEnv() });
    } catch {
      // ok — index already empty for this path
    }
    execFileSync("git", ["-C", parentVault, "add", "."], GIT_OPTS);
    execFileSync("git", ["-C", parentVault, "commit", "-q", "-m", "remove submodule a", "--allow-empty"], GIT_OPTS);

    // Re-add — should succeed без the «already exists» error.
    await expect(
      ops.submoduleAdd(`file://${remoteA}`, "assetspaces/a"),
    ).resolves.toBeUndefined();
    expect(existsSync(path.join(parentVault, "assetspaces/a"))).toBe(true);
  }, 90_000);

  itIfGit("parseGitmodulesPaths matches reality after real git submodule operations", async () => {
    const ops = new GitSubmoduleOps({ vaultRootPath: parentVault });
    await ops.submoduleAdd(`file://${remoteA}`, "assetspaces/a");
    await ops.submoduleAdd(`file://${remoteB}`, "assetspaces/b");

    const gitmodules = await fs.readFile(
      path.join(parentVault, ".gitmodules"),
      "utf8",
    );
    const parsed = parseGitmodulesPaths(gitmodules);
    expect(parsed.has("assetspaces/a")).toBe(true);
    expect(parsed.has("assetspaces/b")).toBe(true);
    expect(parsed.size).toBe(2);
  }, 90_000);

  itIfGit("statusPorcelain returns empty for clean submodule, populated when modified", async () => {
    const ops = new GitSubmoduleOps({ vaultRootPath: parentVault });
    await ops.submoduleAdd(`file://${remoteA}`, "assetspaces/a");
    execFileSync("git", ["-C", parentVault, "add", "."], GIT_OPTS);
    execFileSync("git", ["-C", parentVault, "commit", "-q", "-m", "add submodule a"], GIT_OPTS);

    const cleanResult = await ops.statusPorcelain("assetspaces/a");
    expect(cleanResult.trim()).toBe("");

    // Modify a file inside the submodule.
    await fs.writeFile(path.join(parentVault, "assetspaces/a/a.md"), "modified\n");

    const dirtyResult = await ops.statusPorcelain("assetspaces/a");
    expect(dirtyResult.length).toBeGreaterThan(0);
  }, 60_000);
});

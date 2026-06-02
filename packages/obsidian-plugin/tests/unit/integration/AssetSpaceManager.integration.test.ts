/**
 * @jest-environment node
 *
 * Phase 5 P1.4 — integration tests for the submodule-pull pipeline.
 *
 * Scope (per next-session-prompt-phase5-phase1-asm-pullassetspace-2026-06-02):
 *
 *   1. F5 — submodule **recipe** validation (M2 BLOCKER). The actual
 *      production submodule lifecycle helper is Phase 3 territory; these
 *      tests directly drive `git` via `child_process` to prove the recipe
 *      works on disk. Test file documents the protocol Phase 3 will encode.
 *
 *   2. End-to-end pullAssetSpace → staging-dir population → manual
 *      `git submodule add` integration, demonstrating the handoff path
 *      Phase 3 orchestrator will own.
 *
 *   3. StagingDirTracker concurrency — Promise.all of N concurrent
 *      `allocate()` calls must produce N distinct staging paths with no
 *      registry overwrites.
 *
 * Test environment: each describe-block builds a disposable test vault
 * под `/tmp/exocortex-p1-integration-<ts>/` and tears it down в afterEach.
 *
 * Per advisor-round 2026-06-02: do NOT ship a SubmoduleManager class —
 * Phase 3 work. These tests act as proof-of-concept that the recipe
 * documented in RFC 22b50a17 §Migration plan Phase 3 works on disk.
 */

import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as os from "node:os";
import type { App } from "obsidian";
import { createTar } from "nanotar";

import { AssetSpaceManager } from "../../../src/infrastructure/adapters/AssetSpaceManager";
import { StagingDirTracker } from "../../../src/infrastructure/adapters/StagingDirTracker";
import { PluginLocalDataStore } from "../../../src/infrastructure/adapters/PluginLocalDataStore";

const execFileAsync = promisify(execFile);

/**
 * Run `git <args>` in `cwd`. Returns stdout. Rejects with stderr on non-zero.
 * Sets `GIT_TERMINAL_PROMPT=0` so an accidentally-misconfigured op can't
 * hang the test on credential input.
 */
async function git(cwd: string, ...args: string[]): Promise<string> {
  // Strip any inherited GIT_* env vars — when this test suite runs as a
  // git hook (e.g. husky pre-commit), GIT_DIR / GIT_INDEX_FILE / etc.
  // leak in от the outer process и redirect nested git commands at the
  // parent repository instead of the disposable test dir.
  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("GIT_")) continue;
    if (v !== undefined) cleanEnv[k] = v;
  }
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: {
      ...cleanEnv,
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  return stdout;
}

async function makeDisposableDir(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function cleanDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Initialise a bare git remote + a clone with one initial commit so
 * `git submodule add <remote-url>` succeeds (a totally empty bare repo
 * fails — git refuses to add a no-HEAD remote).
 */
async function makeBareRemoteWithCommit(
  baseDir: string,
  name: string,
): Promise<string> {
  const remotePath = path.join(baseDir, `${name}.git`);
  await fs.mkdir(remotePath, { recursive: true });
  await git(remotePath, "init", "--bare", "--initial-branch=main");

  // Seed the remote via a temp work-tree clone + push.
  const seedClone = path.join(baseDir, `${name}-seed`);
  await git(baseDir, "clone", remotePath, seedClone);
  await fs.writeFile(path.join(seedClone, "README.md"), `# ${name}\n`);
  await git(seedClone, "checkout", "-B", "main");
  await git(seedClone, "add", "README.md");
  await git(seedClone, "commit", "-m", `seed ${name}`);
  await git(seedClone, "push", "-u", "origin", "main");
  await cleanDir(seedClone);

  return remotePath;
}

// ─── 1. F5: git submodule deinit + orphan .git/modules cleanup ─────────────

describe("Phase 5 P1.4 — git submodule M2 BLOCKER recipe", () => {
  let workDir: string;
  let vault: string;

  beforeEach(async () => {
    workDir = await makeDisposableDir("exo-p1-integration-");
    vault = path.join(workDir, "vault");
    await fs.mkdir(vault, { recursive: true });
    await git(vault, "init", "--initial-branch=main");
    // One commit so submodule add has a HEAD to operate against.
    await fs.writeFile(path.join(vault, ".gitkeep"), "");
    await git(vault, "add", ".gitkeep");
    await git(vault, "commit", "-m", "init");
    // Allow file:// submodule URLs (git ≥2.38 disables them by default).
    await git(vault, "config", "protocol.file.allow", "always");
  });

  afterEach(async () => {
    if (workDir) await cleanDir(workDir);
  });

  it("leaves orphan .git/modules/<as>/ after deinit + rm — explicit cleanup removes it (M2 BLOCKER)", async () => {
    const remote = await makeBareRemoteWithCommit(workDir, "foo");
    await git(vault, "submodule", "add", `file://${remote}`, "assetspaces/foo");
    await git(vault, "commit", "-m", "add submodule foo");

    // Verify .git/modules/foo populated post-add.
    const modulesDir = path.join(vault, ".git", "modules", "assetspaces/foo");
    expect(
      await fs
        .access(modulesDir)
        .then(() => true)
        .catch(() => false),
    ).toBe(true);

    // Phase 3 destroy step: deinit + rm work-tree.
    await git(vault, "submodule", "deinit", "-f", "assetspaces/foo");
    await fs.rm(path.join(vault, "assetspaces/foo"), {
      recursive: true,
      force: true,
    });
    // Stage the removal so .gitmodules + index update.
    await git(vault, "rm", "-f", "assetspaces/foo");

    // ⛔ M2 BLOCKER — without the next step, `.git/modules/foo` orphan stays.
    expect(
      await fs
        .access(modulesDir)
        .then(() => true)
        .catch(() => false),
    ).toBe(true);

    // Cleanup: explicit `rm -rf .git/modules/<as>/`.
    await fs.rm(modulesDir, { recursive: true, force: true });

    expect(
      await fs
        .access(modulesDir)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  }, 30000);

  it("supports re-adding the same submodule after full cleanup", async () => {
    const remote = await makeBareRemoteWithCommit(workDir, "bar");
    await git(vault, "submodule", "add", `file://${remote}`, "assetspaces/bar");
    await git(vault, "commit", "-m", "add bar");

    // Destroy chain (recipe from previous test).
    await git(vault, "submodule", "deinit", "-f", "assetspaces/bar");
    await fs.rm(path.join(vault, "assetspaces/bar"), {
      recursive: true,
      force: true,
    });
    await git(vault, "rm", "-f", "assetspaces/bar");
    await fs.rm(path.join(vault, ".git", "modules", "assetspaces/bar"), {
      recursive: true,
      force: true,
    });
    await git(vault, "commit", "-m", "remove bar");

    // Re-add — must succeed (no leftover .git/config or modules entry).
    await expect(
      git(vault, "submodule", "add", `file://${remote}`, "assetspaces/bar"),
    ).resolves.toBeDefined();

    // Verify .git/modules/bar/ repopulated.
    expect(
      await fs
        .access(path.join(vault, ".git", "modules", "assetspaces/bar"))
        .then(() => true)
        .catch(() => false),
    ).toBe(true);
  }, 30000);
});

// ─── 2. F5: .gitmodules atomic rewrite (3 submodules, remove middle) ───────

describe("Phase 5 P1.4 — .gitmodules atomic rewrite", () => {
  let workDir: string;
  let vault: string;

  beforeEach(async () => {
    workDir = await makeDisposableDir("exo-p1-rewrite-");
    vault = path.join(workDir, "vault");
    await fs.mkdir(vault, { recursive: true });
    await git(vault, "init", "--initial-branch=main");
    await fs.writeFile(path.join(vault, ".gitkeep"), "");
    await git(vault, "add", ".gitkeep");
    await git(vault, "commit", "-m", "init");
    await git(vault, "config", "protocol.file.allow", "always");
  });

  afterEach(async () => {
    if (workDir) await cleanDir(workDir);
  });

  it("removes a middle .gitmodules entry via temp-file + rename (preserves siblings)", async () => {
    const remoteA = await makeBareRemoteWithCommit(workDir, "a");
    const remoteB = await makeBareRemoteWithCommit(workDir, "b");
    const remoteC = await makeBareRemoteWithCommit(workDir, "c");

    for (const [name, url] of [
      ["a", remoteA],
      ["b", remoteB],
      ["c", remoteC],
    ] as const) {
      await git(vault, "submodule", "add", `file://${url}`, `assetspaces/${name}`);
    }
    await git(vault, "commit", "-m", "add a/b/c");

    // Atomic-rewrite recipe: read full content, drop [submodule "...b"]
    // block, write to .gitmodules.tmp, rename атомично over .gitmodules.
    const gmPath = path.join(vault, ".gitmodules");
    const original = await fs.readFile(gmPath, "utf8");
    expect(original).toMatch(/\[submodule "assetspaces\/b"\]/);

    const rewritten = removeSubmoduleSection(original, "assetspaces/b");
    expect(rewritten).not.toMatch(/\[submodule "assetspaces\/b"\]/);
    expect(rewritten).toMatch(/\[submodule "assetspaces\/a"\]/);
    expect(rewritten).toMatch(/\[submodule "assetspaces\/c"\]/);

    const tmpPath = gmPath + ".tmp";
    await fs.writeFile(tmpPath, rewritten);
    await fs.rename(tmpPath, gmPath); // atomic on POSIX

    const final = await fs.readFile(gmPath, "utf8");
    expect(final).toBe(rewritten);
  }, 30000);
});

// ─── 3. End-to-end: pullAssetSpace → submodule add ─────────────────────────

describe("Phase 5 P1.4 — pullAssetSpace → submodule handoff (E2E)", () => {
  let workDir: string;
  let vault: string;
  let tracker: StagingDirTracker;
  let store: PluginLocalDataStore;
  let mgr: AssetSpaceManager;
  let fakeApp: App;
  let mockClient: {
    fetchTarballBuffer: jest.Mock;
    ensureRateLimit: jest.Mock;
  };

  beforeEach(async () => {
    workDir = await makeDisposableDir("exo-p1-e2e-");
    vault = path.join(workDir, "vault");
    await fs.mkdir(vault, { recursive: true });
    await git(vault, "init", "--initial-branch=main");
    await fs.writeFile(path.join(vault, ".gitkeep"), "");
    await git(vault, "add", ".gitkeep");
    await git(vault, "commit", "-m", "init");
    await git(vault, "config", "protocol.file.allow", "always");

    const diskRoot = path.join(workDir, "appdisk");
    await fs.mkdir(diskRoot, { recursive: true });

    fakeApp = {
      vault: {
        getMarkdownFiles: () => [],
        adapter: {
          read: async (p: string) => fs.readFile(path.join(diskRoot, p), "utf8"),
          exists: async (p: string) =>
            fs
              .access(path.join(diskRoot, p))
              .then(() => true)
              .catch(() => false),
          write: async (p: string, content: string) => {
            const abs = path.join(diskRoot, p);
            await fs.mkdir(path.dirname(abs), { recursive: true });
            await fs.writeFile(abs, content);
          },
        },
        configDir: ".obsidian",
      },
      metadataCache: { getFileCache: () => null },
    } as unknown as App;

    store = new PluginLocalDataStore({
      app: fakeApp,
      path: "data.local.json",
    });
    await store.init();
    tracker = new StagingDirTracker({
      localDataStore: store,
      tmpdirBase: workDir,
    });
    mockClient = {
      fetchTarballBuffer: jest.fn(),
      ensureRateLimit: jest.fn().mockResolvedValue(undefined),
    } as never;
    mgr = new AssetSpaceManager({
      app: fakeApp,
      client: mockClient as never,
      notifications: {
        info: () => undefined,
        success: () => undefined,
        error: () => undefined,
        warn: () => undefined,
        confirm: async () => true,
      },
      stagingTracker: tracker,
    });
  });

  afterEach(async () => {
    if (workDir) await cleanDir(workDir);
  });

  it("staging payload can be moved into vault + integrated via git submodule add", async () => {
    // 1. Build real tarball — wrapper `kitelev-exoas-foo-deadbef/`.
    const wrapper = "kitelev-exoas-foo-deadbef";
    const files = [
      { name: `${wrapper}/README.md`, data: new TextEncoder().encode("# foo\n") },
      { name: `${wrapper}/sub/a.md`, data: new TextEncoder().encode("# A\n") },
    ];
    const tarBuf = createTar(files);
    const blob = await new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(tarBuf);
          c.close();
        },
      }).pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();
    mockClient.fetchTarballBuffer.mockResolvedValue(blob);

    // 2. Pull AssetSpace — should populate staging with wrapper-stripped layout.
    const result = await mgr.pullAssetSpace(
      "foo-uid",
      "https://github.com/kitelev/exoas-foo",
    );
    expect(result.sha).toBe("deadbef");
    const readme = await fs.readFile(
      path.join(result.stagingPath, "README.md"),
      "utf8",
    );
    expect(readme).toBe("# foo\n");

    // 3. Initialise a real bare remote that mirrors what staging holds.
    const remote = await makeBareRemoteWithCommit(workDir, "foo-remote");
    const seedClone = path.join(workDir, "seed");
    await git(workDir, "clone", remote, seedClone);
    // Replace seed clone contents with staging files.
    for (const child of await fs.readdir(seedClone)) {
      if (child === ".git") continue;
      await fs.rm(path.join(seedClone, child), { recursive: true, force: true });
    }
    for (const entry of await fs.readdir(result.stagingPath, { withFileTypes: true })) {
      const src = path.join(result.stagingPath, entry.name);
      const dst = path.join(seedClone, entry.name);
      await fs.cp(src, dst, { recursive: true });
    }
    await git(seedClone, "add", ".");
    await git(seedClone, "commit", "-m", "import staging");
    await git(seedClone, "push", "origin", "main");

    // 4. Add as submodule в vault — handoff completes.
    await git(
      vault,
      "submodule",
      "add",
      `file://${remote}`,
      "assetspaces/foo",
    );
    // Verify .git/modules/foo/ populated.
    expect(
      await fs
        .access(path.join(vault, ".git", "modules", "assetspaces/foo"))
        .then(() => true)
        .catch(() => false),
    ).toBe(true);
    // Verify content reachable through submodule work-tree.
    const submoduleReadme = await fs.readFile(
      path.join(vault, "assetspaces/foo/README.md"),
      "utf8",
    );
    expect(submoduleReadme).toBe("# foo\n");

    // 5. Phase 3 will own the staging-release step — release here for cleanup.
    await tracker.release(result.stagingPath);
  }, 60000);
});

// ─── 4. StagingDirTracker concurrency ──────────────────────────────────────

describe("Phase 5 P1.4 — StagingDirTracker concurrency", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await makeDisposableDir("exo-p1-concurrent-");
  });

  afterEach(async () => {
    if (workDir) await cleanDir(workDir);
  });

  it("Promise.all of N concurrent allocate() produces N distinct registered paths", async () => {
    const diskRoot = path.join(workDir, "appdisk");
    await fs.mkdir(diskRoot, { recursive: true });
    const fakeApp = {
      vault: {
        getMarkdownFiles: () => [],
        adapter: {
          read: async (p: string) => fs.readFile(path.join(diskRoot, p), "utf8"),
          exists: async (p: string) =>
            fs
              .access(path.join(diskRoot, p))
              .then(() => true)
              .catch(() => false),
          write: async (p: string, content: string) => {
            const abs = path.join(diskRoot, p);
            await fs.mkdir(path.dirname(abs), { recursive: true });
            await fs.writeFile(abs, content);
          },
        },
        configDir: ".obsidian",
      },
      metadataCache: { getFileCache: () => null },
    } as unknown as App;
    const store = new PluginLocalDataStore({
      app: fakeApp,
      path: "data.local.json",
    });
    await store.init();
    const tracker = new StagingDirTracker({
      localDataStore: store,
      tmpdirBase: workDir,
    });

    const N = 8;
    const paths = await Promise.all(
      Array.from({ length: N }, (_, i) => tracker.allocate(`uid-${i}`)),
    );

    // All distinct
    const uniq = new Set(paths);
    expect(uniq.size).toBe(N);

    // All registered persistently
    const tracked = await store.readActiveStagingDirs();
    expect(tracked).toHaveLength(N);
    for (const p of paths) {
      expect(tracked.some((e) => e.path === p)).toBe(true);
    }

    // All exist on disk
    for (const p of paths) {
      expect(
        await fs
          .access(p)
          .then(() => true)
          .catch(() => false),
      ).toBe(true);
    }
  }, 30000);
});

// ─── Helper: remove a single [submodule "<name>"] section by exact name ────

function removeSubmoduleSection(content: string, name: string): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let skipping = false;
  const headerRegex = /^\[submodule "(.+)"\]\s*$/;
  for (const line of lines) {
    const m = line.match(headerRegex);
    if (m) {
      skipping = m[1] === name;
      if (!skipping) out.push(line);
      continue;
    }
    if (!skipping) out.push(line);
  }
  return out.join("\n");
}

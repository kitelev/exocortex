/**
 * @jest-environment node
 *
 * Integration tests for RFC 13da049f Phase 6.2/6.3 plugin bootstrap, exercising
 * the REAL `GitSubmoduleOps` `.gitmodules` text manipulation + `renameIntoVault`
 * against a real tmpdir vault. The tarball pull is faked (no network) but the
 * staging→vault move + `.gitmodules` write are real filesystem operations, so
 * this proves the end-to-end materialisation contract:
 *   empty vault → bootstrap → `.gitmodules` has 2 entries + assetspaces/exo +
 *   assetspaces/exocmd populated.
 */

/* eslint-disable no-restricted-imports, import/no-nodejs-modules */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
/* eslint-enable no-restricted-imports, import/no-nodejs-modules */

import type { App } from "obsidian";

import { GitSubmoduleOps } from "../../../src/infrastructure/adapters/GitSubmoduleOps";
import { AssetSpaceManager } from "../../../src/infrastructure/adapters/AssetSpaceManager";
import { StagingDirTracker } from "../../../src/infrastructure/adapters/StagingDirTracker";
import { PluginLocalDataStore } from "../../../src/infrastructure/adapters/PluginLocalDataStore";
import {
  BootstrapAssetSpaceCommands,
  type IAssetSpacePuller,
  type IFileOnlyAssetSpaceStore,
} from "../../../src/infrastructure/adapters/BootstrapAssetSpaceCommands";

const EXO_URL = "https://github.com/kitelev/exoas-exo";
const EXOCMD_URL = "https://github.com/kitelev/exoas-exocmd";

async function makeTmpVault(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "exo-bootstrap-it-"));
}

/**
 * Fake puller — materialises a fake AssetSpace into a fresh staging dir (a
 * single `<sha>.md` file) and returns the real staging path so the real
 * `renameIntoVault` can move it into the vault.
 */
function makeFakePuller(): IAssetSpacePuller {
  return {
    pullAssetSpace: async (asUid: string, _url: string, _ref?: string) => {
      const staging = await fs.mkdtemp(
        path.join(os.tmpdir(), `exo-staging-${asUid}-`),
      );
      await fs.writeFile(
        path.join(staging, "73bd00e4-ccc0-4f3f-b20d-c4388c4588fb.md"),
        "---\nexo__Asset_uid: 73bd00e4\n---\n",
        "utf8",
      );
      return { asUid, stagingPath: staging, sha: "deadbee" };
    },
    // Mirrors StagingDirTracker.release — tolerant best-effort removal.
    releaseStaging: async (stagingPath: string) => {
      await fs
        .rm(stagingPath, { recursive: true, force: true })
        .catch(() => undefined);
    },
  };
}

function makeVaultProbes(vaultRoot: string) {
  return {
    vaultExists: async (p: string): Promise<boolean> => {
      try {
        await fs.access(path.join(vaultRoot, p));
        return true;
      } catch {
        return false;
      }
    },
    listFolder: async (
      dir: string,
    ): Promise<{ files: string[]; folders: string[] }> => {
      const abs = path.join(vaultRoot, dir);
      const files: string[] = [];
      const folders: string[] = [];
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(abs, { withFileTypes: true });
      } catch {
        return { files, folders };
      }
      for (const e of entries) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) folders.push(rel);
        else files.push(rel);
      }
      return { files, folders };
    },
  };
}

function makeFakeLocalStore(): {
  store: IFileOnlyAssetSpaceStore;
  entries: Array<{ folderName: string; url: string; sha: string }>;
} {
  const entries: Array<{ folderName: string; url: string; sha: string }> = [];
  return {
    entries,
    store: {
      upsertFileOnlyAssetSpace: async (e) => {
        entries.push({ folderName: e.folderName, url: e.url, sha: e.sha });
      },
    },
  };
}

describe("Bootstrap integration — real GitSubmoduleOps + tmpdir vault (git mode)", () => {
  let vaultRoot: string;
  afterEach(async () => {
    if (vaultRoot) await fs.rm(vaultRoot, { recursive: true, force: true });
  });

  it("empty vault → bootstrap → 2 .gitmodules entries + assetspaces/exo + assetspaces/exocmd populated", async () => {
    vaultRoot = await makeTmpVault();
    const gitOps = new GitSubmoduleOps({ vaultRootPath: vaultRoot });
    const probes = makeVaultProbes(vaultRoot);
    const { store } = makeFakeLocalStore();
    const notices: string[] = [];

    const fakePuller = makeFakePuller();
    const cmds = new BootstrapAssetSpaceCommands({
      getPuller: async () => fakePuller,
      gitOps,
      localStore: store,
      vaultExists: probes.vaultExists,
      listFolder: probes.listFolder,
      isGitVault: async () => true,
      validateUrl: () => undefined,
      deriveFolderName: (u) => u.split("/").pop() ?? "x",
      promptBootstrapUrls: async () => ({
        exoUrl: EXO_URL,
        exocmdUrl: EXOCMD_URL,
      }),
      promptAddAssetSpaceUrl: async () => null,
      confirm: async () => true,
      notify: (m) => notices.push(m),
    });

    await cmds.invokeBootstrap();

    // Both folders materialised with the fake AssetSpace file.
    const exoFile = path.join(
      vaultRoot,
      "assetspaces/exo/73bd00e4-ccc0-4f3f-b20d-c4388c4588fb.md",
    );
    const exocmdFile = path.join(
      vaultRoot,
      "assetspaces/exocmd/73bd00e4-ccc0-4f3f-b20d-c4388c4588fb.md",
    );
    await expect(fs.access(exoFile)).resolves.toBeUndefined();
    await expect(fs.access(exocmdFile)).resolves.toBeUndefined();

    // `.gitmodules` has exactly the two TS-floor entries.
    const entries = await gitOps.readGitmodulesEntries();
    expect(entries).toEqual([
      { submodulePath: "assetspaces/exo", url: EXO_URL },
      { submodulePath: "assetspaces/exocmd", url: EXOCMD_URL },
    ]);

    expect(notices.some((n) => /Bootstrap complete/.test(n))).toBe(true);
  });

  it("re-running bootstrap on a populated vault is a no-op", async () => {
    vaultRoot = await makeTmpVault();
    // Seed assetspaces/exo with content so detectVaultState → bootstrapped.
    await fs.mkdir(path.join(vaultRoot, "assetspaces/exo"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(vaultRoot, "assetspaces/exo/seed.md"),
      "x",
      "utf8",
    );
    const gitOps = new GitSubmoduleOps({ vaultRootPath: vaultRoot });
    const probes = makeVaultProbes(vaultRoot);
    const { store } = makeFakeLocalStore();
    const puller = makeFakePuller();
    const pullSpy = jest.spyOn(puller, "pullAssetSpace");

    const cmds = new BootstrapAssetSpaceCommands({
      puller,
      gitOps,
      localStore: store,
      vaultExists: probes.vaultExists,
      listFolder: probes.listFolder,
      isGitVault: async () => true,
      validateUrl: () => undefined,
      deriveFolderName: (u) => u.split("/").pop() ?? "x",
      promptBootstrapUrls: async () => ({
        exoUrl: EXO_URL,
        exocmdUrl: EXOCMD_URL,
      }),
      promptAddAssetSpaceUrl: async () => null,
      confirm: async () => true,
      notify: () => undefined,
    });

    await cmds.invokeBootstrap();
    expect(pullSpy).not.toHaveBeenCalled();
  });
});

describe("GitSubmoduleOps.appendGitmodulesEntry — real fs", () => {
  let vaultRoot: string;
  afterEach(async () => {
    if (vaultRoot) await fs.rm(vaultRoot, { recursive: true, force: true });
  });

  it("creates .gitmodules when missing, then is idempotent", async () => {
    vaultRoot = await makeTmpVault();
    const gitOps = new GitSubmoduleOps({ vaultRootPath: vaultRoot });

    const r1 = await gitOps.appendGitmodulesEntry("assetspaces/exo", EXO_URL);
    expect(r1.added).toBe(true);
    const r2 = await gitOps.appendGitmodulesEntry("assetspaces/exo", EXO_URL);
    expect(r2.added).toBe(false); // idempotent — no duplicate stanza

    const raw = await fs.readFile(
      path.join(vaultRoot, ".gitmodules"),
      "utf8",
    );
    const headerCount = (raw.match(/\[submodule "assetspaces\/exo"\]/g) ?? [])
      .length;
    expect(headerCount).toBe(1);
  });

  it("appends a second distinct entry preserving the first", async () => {
    vaultRoot = await makeTmpVault();
    const gitOps = new GitSubmoduleOps({ vaultRootPath: vaultRoot });
    await gitOps.appendGitmodulesEntry("assetspaces/exo", EXO_URL);
    await gitOps.appendGitmodulesEntry("assetspaces/exocmd", EXOCMD_URL);
    const entries = await gitOps.readGitmodulesEntries();
    expect(entries).toEqual([
      { submodulePath: "assetspaces/exo", url: EXO_URL },
      { submodulePath: "assetspaces/exocmd", url: EXOCMD_URL },
    ]);
  });

  it("rejects path traversal / non-github URL", async () => {
    vaultRoot = await makeTmpVault();
    const gitOps = new GitSubmoduleOps({ vaultRootPath: vaultRoot });
    await expect(
      gitOps.appendGitmodulesEntry("../escape", EXO_URL),
    ).rejects.toThrow();
    await expect(
      gitOps.appendGitmodulesEntry("assetspaces/x", "https://evil.com/a/b"),
    ).rejects.toThrow();
  });
});

/**
 * Fake App backed by real Node `fs` so PluginLocalDataStore actually persists
 * `_activeStagingDirs` to disk (mirrors `AssetSpaceManager.pullAssetSpace.test`
 * harness). Anchored under `diskRoot/` for test isolation.
 */
function makeFakeApp(diskRoot: string): App {
  const resolve = (p: string) => path.join(diskRoot, p);
  return {
    vault: {
      getMarkdownFiles: () => [],
      adapter: {
        read: async (p: string) => fs.readFile(resolve(p), "utf8"),
        exists: async (p: string) =>
          fs
            .access(resolve(p))
            .then(() => true)
            .catch(() => false),
        write: async (p: string, content: string) => {
          const abs = resolve(p);
          await fs.mkdir(path.dirname(abs), { recursive: true });
          await fs.writeFile(abs, content);
        },
      },
      configDir: ".obsidian",
    },
    metadataCache: { getFileCache: () => null },
  } as unknown as App;
}

/**
 * Issue #3391 — end-to-end proof that a successful materialise leaves NO
 * leftover `_activeStagingDirs` entry WITHOUT a plugin reload.
 *
 * Maximally production-shape: a REAL {@link StagingDirTracker} (backed by a
 * REAL {@link PluginLocalDataStore} on a tmpdir-backed fake App) wired into a
 * REAL {@link AssetSpaceManager}. Only the network/extract step of
 * `pullAssetSpace` is faked — and even that fake calls the REAL
 * `tracker.allocate` so `_activeStagingDirs` is populated exactly like
 * production. `releaseStaging` is the REAL `AssetSpaceManager.releaseStaging`
 * delegate → REAL `StagingDirTracker.release`. The staging→vault move
 * (`renameIntoVault`) is the REAL `GitSubmoduleOps` against a real tmpdir vault.
 *
 * Revert-verify: deleting `await puller.releaseStaging(...)` from
 * `BootstrapAssetSpaceCommands.materialize` makes both assertions below FAIL
 * (`readActiveStagingDirs()` returns the 1–2 entries `allocate` registered);
 * restoring the line makes them PASS.
 */
describe("Bootstrap integration — staging-dir release (Issue #3391, real tracker)", () => {
  let tmpdirBase: string;
  let vaultRoot: string;
  afterEach(async () => {
    if (tmpdirBase)
      await fs.rm(tmpdirBase, { recursive: true, force: true }).catch(() => {});
    if (vaultRoot)
      await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {});
  });

  async function makeRealTrackerHarness(): Promise<{
    store: PluginLocalDataStore;
    mgr: AssetSpaceManager;
  }> {
    tmpdirBase = await fs.mkdtemp(path.join(os.tmpdir(), "exo-3391-base-"));
    const diskRoot = path.join(tmpdirBase, "ldstore");
    await fs.mkdir(diskRoot, { recursive: true });
    const app = makeFakeApp(diskRoot);
    const store = new PluginLocalDataStore({ app, path: "data.local.json" });
    await store.init();
    const tracker = new StagingDirTracker({ localDataStore: store, tmpdirBase });
    const mgr = new AssetSpaceManager({
      app,
      // Unused: pullAssetSpace is mocked below to skip the GitHub REST path.
      client: {} as never,
      notifications: {
        info: () => undefined,
        success: () => undefined,
        error: () => undefined,
        warn: () => undefined,
        confirm: async () => true,
      } as never,
      stagingTracker: tracker,
    });
    // Fake ONLY the network/extract: allocate a REAL staging dir (registers in
    // `_activeStagingDirs` exactly like production) + drop a fake AssetSpace
    // file. releaseStaging stays the REAL delegate to tracker.release.
    jest
      .spyOn(mgr, "pullAssetSpace")
      .mockImplementation(async (asUid: string) => {
        const staging = await tracker.allocate(asUid);
        await fs.writeFile(
          path.join(staging, "73bd00e4-ccc0-4f3f-b20d-c4388c4588fb.md"),
          "---\nexo__Asset_uid: 73bd00e4\n---\n",
          "utf8",
        );
        return { asUid, stagingPath: staging, sha: "deadbee" };
      });
    return { store, mgr };
  }

  it("empty vault → bootstrap → _activeStagingDirs is empty (no reload)", async () => {
    vaultRoot = await makeTmpVault();
    const { store, mgr } = await makeRealTrackerHarness();
    const gitOps = new GitSubmoduleOps({ vaultRootPath: vaultRoot });
    const probes = makeVaultProbes(vaultRoot);
    const { store: fileStore } = makeFakeLocalStore();

    const cmds = new BootstrapAssetSpaceCommands({
      getPuller: async () => mgr,
      gitOps,
      localStore: fileStore,
      vaultExists: probes.vaultExists,
      listFolder: probes.listFolder,
      isGitVault: async () => true,
      validateUrl: () => undefined,
      deriveFolderName: (u) => u.split("/").pop() ?? "x",
      promptBootstrapUrls: async () => ({ exoUrl: EXO_URL, exocmdUrl: EXOCMD_URL }),
      promptAddAssetSpaceUrl: async () => null,
      confirm: async () => true,
      notify: () => undefined,
    });

    await cmds.invokeBootstrap();

    // Both pulled, both moved into the vault, both staging entries released.
    expect((mgr.pullAssetSpace as jest.Mock).mock.calls).toHaveLength(2);
    await expect(fs.access(
      path.join(vaultRoot, "assetspaces/exo/73bd00e4-ccc0-4f3f-b20d-c4388c4588fb.md"),
    )).resolves.toBeUndefined();
    // The crux of #3391: registry empty WITHOUT a reload / sweepOrphans.
    expect(await store.readActiveStagingDirs()).toEqual([]);
  });

  it("EC2 clone-needs-fetch → fetchTrackedAssetSpaces → _activeStagingDirs empty", async () => {
    vaultRoot = await makeTmpVault();
    // Seed .gitmodules with two tracked entries; folders stay empty so
    // detectVaultState → clone-needs-fetch → fetchTrackedAssetSpaces.
    const gitOps = new GitSubmoduleOps({ vaultRootPath: vaultRoot });
    await gitOps.appendGitmodulesEntry("assetspaces/exo", EXO_URL);
    await gitOps.appendGitmodulesEntry("assetspaces/exocmd", EXOCMD_URL);

    const { store, mgr } = await makeRealTrackerHarness();
    const probes = makeVaultProbes(vaultRoot);
    const { store: fileStore } = makeFakeLocalStore();

    const cmds = new BootstrapAssetSpaceCommands({
      getPuller: async () => mgr,
      gitOps,
      localStore: fileStore,
      vaultExists: probes.vaultExists,
      listFolder: probes.listFolder,
      isGitVault: async () => true,
      validateUrl: () => undefined,
      deriveFolderName: (u) => u.split("/").pop() ?? "x",
      promptBootstrapUrls: async () => null,
      promptAddAssetSpaceUrl: async () => null,
      confirm: async () => true,
      notify: () => undefined,
    });

    await cmds.invokeBootstrap();

    expect((mgr.pullAssetSpace as jest.Mock).mock.calls).toHaveLength(2);
    expect(await store.readActiveStagingDirs()).toEqual([]);
  });
});

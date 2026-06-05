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

import { GitSubmoduleOps } from "../../../src/infrastructure/adapters/GitSubmoduleOps";
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

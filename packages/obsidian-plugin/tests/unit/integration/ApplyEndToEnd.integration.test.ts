/**
 * @jest-environment node
 *
 * End-to-end integration test for `applyProfile()` algorithm against
 * a real disposable git vault on the local filesystem.
 *
 * Scope:
 *   - Real GitSubmoduleOps (subprocess `git`)
 *   - Real SwitchCacheLayer (Node fs + nanotar)
 *   - Real `.gitmodules` mutation
 *   - Mocked AssetSpaceManager.pullAssetSpace (avoids network/GitHub flakiness;
 *     the tarball pull path is independently tested by
 *     AssetSpaceManager.pullAssetSpace.test.ts)
 *   - Fake App + IConfirmGate + IRdfIndexer + ISettingsStore + IProfileResolver
 *
 * Flow per prompt P3.6:
 *   1. Init test vault with 3 AS submodules (file:// URLs)
 *   2. Two profiles — profile-A {AS1, AS2}, profile-B {AS2, AS3}
 *   3. Active = profile-A → vault has AS1 + AS2
 *   4. applyProfile(profile-B)
 *   5. Verify vault now has AS2 + AS3
 *   6. Verify .gitmodules correctly reflects new state
 *   7. Verify cache contains AS1 tarball
 *   8. Switch back to profile-A — verify AS1 materialized
 */
/* eslint-disable no-restricted-imports, import/no-nodejs-modules */
import { execSync, execFileSync } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
/* eslint-enable no-restricted-imports, import/no-nodejs-modules */

import type { App, TFile } from "obsidian";
import type { HardSwitchPlan, IConfirmGate } from "exocortex";

import {
  ProfileApplyManager,
  type IProfileResolver,
  type IRdfIndexer,
  type ISettingsStore,
  type ProfileResolution,
  type SwitchSettings,
} from "../../../src/infrastructure/adapters/ProfileApplyManager";
import { PluginLockManager } from "../../../src/infrastructure/adapters/PluginLockManager";
import {
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_EXOCMD,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
} from "../../../src/infrastructure/adapters/ProfileOnloadWiring";
import { GitSubmoduleOps } from "../../../src/infrastructure/adapters/GitSubmoduleOps";
import { SwitchCacheLayer } from "../../../src/infrastructure/adapters/SwitchCacheLayer";
import { UncommittedChangesGuard } from "../../../src/infrastructure/adapters/UncommittedChangesGuard";

function hasGitBinary(): boolean {
  try {
    execSync("git --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

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

// Set the protocol.file.allow override on the global process.env BEFORE
// GitSubmoduleOps (which reads process.env in stripGitEnv) executes any
// `git submodule add` call. CVE-2022-39253 mitigation в CI runners (git
// ≥2.38) rejects file:// transport without this override.
process.env.GIT_CONFIG_COUNT = "1";
process.env.GIT_CONFIG_KEY_0 = "protocol.file.allow";
process.env.GIT_CONFIG_VALUE_0 = "always";

const GIT_OPTS = { env: cleanGitEnv() };
const itIfGit = hasGitBinary() ? it : it.skip;

async function makeRemoteRepo(label: string, content: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `exo-p3-e2e-remote-${label}-`));
  execFileSync("git", ["init", "-q", "-b", "main", dir], GIT_OPTS);
  execFileSync("git", ["-C", dir, "config", "user.email", "test@example.com"], GIT_OPTS);
  execFileSync("git", ["-C", dir, "config", "user.name", "Test"], GIT_OPTS);
  for (const [rel, body] of Object.entries(content)) {
    const abs = path.join(dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body);
  }
  execFileSync("git", ["-C", dir, "add", "."], GIT_OPTS);
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "init"], GIT_OPTS);
  return dir;
}

interface VaultSetup {
  vaultPath: string;
  cacheDir: string;
  remoteAS1: string;
  remoteAS2: string;
  remoteAS3: string;
  remoteFloors: Record<string, string>;
}

async function initVaultWithAS(materialized: string[]): Promise<VaultSetup> {
  const vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), "exo-p3-e2e-vault-"));
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "exo-p3-e2e-cache-"));
  execFileSync("git", ["init", "-q", "-b", "main", vaultPath], GIT_OPTS);
  execFileSync("git", ["-C", vaultPath, "config", "user.email", "test@example.com"], GIT_OPTS);
  execFileSync("git", ["-C", vaultPath, "config", "user.name", "Test"], GIT_OPTS);
  execFileSync("git", ["-C", vaultPath, "config", "protocol.file.allow", "always"], GIT_OPTS);
  await fs.writeFile(path.join(vaultPath, "README.md"), "vault\n");
  execFileSync("git", ["-C", vaultPath, "add", "README.md"], GIT_OPTS);
  execFileSync("git", ["-C", vaultPath, "commit", "-q", "-m", "init"], GIT_OPTS);

  const remoteAS1 = await makeRemoteRepo("as1", { "a.md": "AS1 file a\n", "b.md": "AS1 file b\n" });
  const remoteAS2 = await makeRemoteRepo("as2", { "x.md": "AS2 file x\n" });
  const remoteAS3 = await makeRemoteRepo("as3", { "y.md": "AS3 file y\n" });
  const remoteFloors: Record<string, string> = {};
  for (const [label, uid] of Object.entries({
    exo: TS_FLOOR_AS_UID_EXO,
    exocmd: TS_FLOOR_AS_UID_EXOCMD,
    "shared-identities": TS_FLOOR_AS_UID_SHARED_IDENTITIES,
  })) {
    remoteFloors[uid] = await makeRemoteRepo(label, { "tbox.md": `${label} TBox\n` });
  }

  // Pre-materialize floor + caller-specified extras.
  for (const folder of [
    { name: "exo", url: remoteFloors[TS_FLOOR_AS_UID_EXO] },
    { name: "exocmd", url: remoteFloors[TS_FLOOR_AS_UID_EXOCMD] },
    { name: "shared-identities", url: remoteFloors[TS_FLOOR_AS_UID_SHARED_IDENTITIES] },
  ]) {
    execFileSync(
      "git",
      ["-C", vaultPath, "submodule", "add", `file://${folder.url}`, `assetspaces/kitelev/exoas-${folder.name}`],
      GIT_OPTS,
    );
  }
  if (materialized.includes("as1")) {
    execFileSync(
      "git",
      ["-C", vaultPath, "submodule", "add", `file://${remoteAS1}`, "assetspaces/kitelev/exoas-as1"],
      GIT_OPTS,
    );
  }
  if (materialized.includes("as2")) {
    execFileSync(
      "git",
      ["-C", vaultPath, "submodule", "add", `file://${remoteAS2}`, "assetspaces/kitelev/exoas-as2"],
      GIT_OPTS,
    );
  }
  if (materialized.includes("as3")) {
    execFileSync(
      "git",
      ["-C", vaultPath, "submodule", "add", `file://${remoteAS3}`, "assetspaces/kitelev/exoas-as3"],
      GIT_OPTS,
    );
  }
  execFileSync("git", ["-C", vaultPath, "add", "."], GIT_OPTS);
  execFileSync("git", ["-C", vaultPath, "commit", "-q", "-m", "initial submodules"], GIT_OPTS);

  return { vaultPath, cacheDir, remoteAS1, remoteAS2, remoteAS3, remoteFloors };
}

interface FakeFile {
  path: string;
  basename: string;
  frontmatter: Record<string, unknown>;
}

function buildVaultFiles(setup: VaultSetup): FakeFile[] {
  const files: FakeFile[] = [
    {
      path: "profiles/profile-a.md",
      basename: "profile-a",
      frontmatter: {
        "exo__Asset_uid": "profile-a",
        "exo__Asset_label": "Profile A",
        "exo__Instance_class": ["[[exo__Profile]]"],
      },
    },
    {
      path: "profiles/profile-b.md",
      basename: "profile-b",
      frontmatter: {
        "exo__Asset_uid": "profile-b",
        "exo__Asset_label": "Profile B",
        "exo__Instance_class": ["[[exo__Profile]]"],
      },
    },
  ];
  const allAs: Array<{ uid: string; folder: string; git: string }> = [
    { uid: TS_FLOOR_AS_UID_EXO, folder: "assetspaces/kitelev/exoas-exo", git: `file://${setup.remoteFloors[TS_FLOOR_AS_UID_EXO]}` },
    { uid: TS_FLOOR_AS_UID_EXOCMD, folder: "assetspaces/kitelev/exoas-exocmd", git: `file://${setup.remoteFloors[TS_FLOOR_AS_UID_EXOCMD]}` },
    { uid: TS_FLOOR_AS_UID_SHARED_IDENTITIES, folder: "assetspaces/kitelev/exoas-shared-identities", git: `file://${setup.remoteFloors[TS_FLOOR_AS_UID_SHARED_IDENTITIES]}` },
    { uid: "as1", folder: "assetspaces/kitelev/exoas-as1", git: `file://${setup.remoteAS1}` },
    { uid: "as2", folder: "assetspaces/kitelev/exoas-as2", git: `file://${setup.remoteAS2}` },
    { uid: "as3", folder: "assetspaces/kitelev/exoas-as3", git: `file://${setup.remoteAS3}` },
  ];
  for (const as of allAs) {
    files.push({
      path: `${as.folder}/${as.uid}.md`,
      basename: as.uid,
      frontmatter: {
        "exo__Asset_uid": as.uid,
        "exo__Asset_label": as.folder.split("/").pop(),
        "exo__Instance_class": ["[[exo__AssetSpace]]"],
        // RFC 01a83de8 Phase 1b T3 — the test clone source is a `file://` local
        // repo, for which `derivePath` returns null (no hosted owner/repo). So
        // folderName falls back to the descriptor's parent folder, which IS the
        // derived mount path here (descriptor co-located at `${as.folder}`). The
        // real `git submodule add` clones from this `file://` _git.
        "exo__AssetSpace_git": as.git,
        "exo__AssetSpace_namespace": as.folder.split("/").pop(),
        // Production-shape (RFC 01a83de8 Phase 2): profiles `_includes`
        // reference this AS UID directly, so the R24 guard resolves it against
        // the folder map — no Ontology→AS translation (removed in T3b-cleanup).
      },
    });
  }
  return files;
}

function makeFakeApp(files: FakeFile[], vaultRootPath?: string): {
  app: App;
  walkDir: (dir: string) => Promise<{ files: string[]; folders: string[] }>;
} {
  const tfiles = files.map((f) => ({ path: f.path, basename: f.basename }) as unknown as TFile);
  const fmByPath = new Map<string, Record<string, unknown>>();
  for (const f of files) fmByPath.set(f.path, f.frontmatter);

  const vaultFiles = new Map<string, string>();
  // Helper used by enumerateFilesUnder — sync recursive Node listing.
  async function walkDir(dir: string): Promise<{ files: string[]; folders: string[] }> {
    const folders: string[] = [];
    const files: string[] = [];
    return { files, folders };
  }

  const app = {
    vault: {
      getMarkdownFiles: () => tfiles,
      adapter: {
        // Phase 6 amendment: derivePhysicallyMaterializedAsUids calls
        // adapter.exists(<submodulePath>). Real Obsidian returns true для
        // directories; fake here ALSO consults real disk under vaultRootPath
        // (the test creates real submodules — disk is ground truth).
        exists: async (p: string) => {
          if (vaultFiles.has(p)) return true;
          if (vaultRootPath !== undefined) {
            try {
              return existsSync(path.join(vaultRootPath, p));
            } catch {
              return false;
            }
          }
          return false;
        },
        read: async (p: string) => {
          const v = vaultFiles.get(p);
          if (v === undefined) throw new Error(`ENOENT: ${p}`);
          return v;
        },
        write: async (p: string, d: string) => {
          vaultFiles.set(p, d);
        },
        remove: async (p: string) => {
          vaultFiles.delete(p);
        },
        list: async () => ({ files: [], folders: [] }),
      },
    },
    metadataCache: {
      getFileCache: (f: TFile) => {
        const fm = fmByPath.get(f.path);
        return fm ? { frontmatter: fm } : null;
      },
    },
  } as unknown as App;
  return { app, walkDir };
}

class FakeResolver implements IProfileResolver {
  constructor(private readonly profiles: Map<string, ProfileResolution>) {}
  async resolve(uid: string): Promise<ProfileResolution | null> {
    return this.profiles.get(uid) ?? null;
  }
  async discoverSharedOntologies(): Promise<string[]> {
    return [];
  }
}

class FakeIndexer implements IRdfIndexer {
  calls: number = 0;
  async refresh(): Promise<void> {
    this.calls++;
  }
}

class FakeSettingsStore implements ISettingsStore {
  state: SwitchSettings = { activeProfileUid: null, _switchInProgress: false };
  async load(): Promise<SwitchSettings> {
    return { ...this.state };
  }
  async save(s: SwitchSettings): Promise<void> {
    this.state = { ...s };
  }
}

class FakeLocalDataStore {
  private state = { activeProfileUid: null as string | null, _switchInProgress: false };
  getActiveProfileUid() {
    return this.state.activeProfileUid;
  }
  isSwitchInProgress() {
    return this.state._switchInProgress;
  }
  snapshot() {
    return { ...this.state };
  }
  async save(s: { activeProfileUid: string | null; _switchInProgress: boolean }): Promise<void> {
    this.state = { ...s };
  }
}

class AlwaysApproveGate implements IConfirmGate {
  async confirmHardSwitch(_plan: HardSwitchPlan): Promise<boolean> {
    return true;
  }
}

/**
 * Mocked AssetSpaceManager.pullAssetSpace — copies the source repo's HEAD
 * tree into a staging dir. Bypasses GitHub REST tarball path (which is
 * independently tested) so this E2E stays offline и deterministic.
 */
class FakePullingAssetSpaceManager {
  pulls: Array<{ asUid: string; gitUrl: string }> = [];
  stagingTracker = {
    released: [] as string[],
    release: async (p: string) => {
      this.stagingTracker.released.push(p);
      await fs.rm(p, { recursive: true, force: true }).catch(() => undefined);
    },
  };
  async pullAssetSpace(asUid: string, gitUrl: string, _ref: string) {
    this.pulls.push({ asUid, gitUrl });
    const stagingPath = await fs.mkdtemp(path.join(os.tmpdir(), `exo-p3-e2e-staging-${asUid}-`));
    // Strip `file://` prefix to find the local repo path.
    const srcRepo = gitUrl.replace(/^file:\/\//, "");
    // Recursively copy non-`.git` content.
    await copyTree(srcRepo, stagingPath);
    return { asUid, stagingPath, sha: "deadbee" };
  }
}

async function copyTree(src: string, dest: string): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      await copyTree(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

describe("applyProfile E2E (real fs, mocked pull)", () => {
  let setup: VaultSetup;

  afterEach(async () => {
    if (setup) {
      for (const dir of [
        setup.vaultPath,
        setup.cacheDir,
        setup.remoteAS1,
        setup.remoteAS2,
        setup.remoteAS3,
        ...Object.values(setup.remoteFloors),
      ]) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  });

  itIfGit("switches from {as1, as2} → {as2, as3}: destroys as1, materializes as3, verifies .gitmodules + cache", async () => {
    setup = await initVaultWithAS(["as1", "as2"]);

    const files = buildVaultFiles(setup);
    const { app } = makeFakeApp(files, setup.vaultPath);

    // Profiles declare AssetSpace UIDs directly (production shape per RFC
    // 01a83de8 Phase 2); the R24 guard resolves them against the folder map —
    // the former Ontology→AS translation was removed in Phase 3 T3b-cleanup.
    const profiles = new Map<string, ProfileResolution>([
      [
        "profile-a",
        {
          uid: "profile-a",
          includes: [
            "as1",
            "as2",
            TS_FLOOR_AS_UID_EXO,
            TS_FLOOR_AS_UID_EXOCMD,
            TS_FLOOR_AS_UID_SHARED_IDENTITIES,
          ],
          label: "Profile A",
        },
      ],
      [
        "profile-b",
        {
          uid: "profile-b",
          includes: [
            "as2",
            "as3",
            TS_FLOOR_AS_UID_EXO,
            TS_FLOOR_AS_UID_EXOCMD,
            TS_FLOOR_AS_UID_SHARED_IDENTITIES,
          ],
          label: "Profile B",
        },
      ],
    ]);

    const lockMgr = new PluginLockManager({ app });
    const localData = new FakeLocalDataStore();
    await localData.save({ activeProfileUid: "profile-a", _switchInProgress: false });
    const gitOps = new GitSubmoduleOps({ vaultRootPath: setup.vaultPath });
    const uncommittedGuard = new UncommittedChangesGuard({ gitOps });
    const assetSpaceManager = new FakePullingAssetSpaceManager();
    const cacheLayer = new SwitchCacheLayer({ cacheDir: setup.cacheDir });

    const mgr = new ProfileApplyManager({
      app,
      lockMgr,
      resolver: new FakeResolver(profiles),
      rdfIndexer: new FakeIndexer(),
      settingsStore: new FakeSettingsStore(),
      /* eslint-disable @typescript-eslint/no-explicit-any */
      assetSpaceManager: assetSpaceManager as any,
      uncommittedGuard,
      gitOps,
      cacheLayer,
      confirmGate: new AlwaysApproveGate(),
      localDataStore: localData as any,
      /* eslint-enable @typescript-eslint/no-explicit-any */
      vaultRootPath: setup.vaultPath,
    });

    // ---- ACT ----
    await mgr.applyProfile("profile-b");

    // ---- ASSERT vault state ----
    expect(existsSync(path.join(setup.vaultPath, "assetspaces/kitelev/exoas-as1"))).toBe(false);
    expect(existsSync(path.join(setup.vaultPath, "assetspaces/kitelev/exoas-as2"))).toBe(true);
    expect(existsSync(path.join(setup.vaultPath, "assetspaces/kitelev/exoas-as3"))).toBe(true);

    // ---- ASSERT .gitmodules ----
    // Phase 6 Vision Lock #9 amendment (RFC 13da049f v1.3):
    // .gitmodules entry для destroyed AS preserved (per-vault URL registry для switch-back).
    // Working tree destroyed (line 450 verified), but .gitmodules entry persists.
    const gitmodules = await fs.readFile(path.join(setup.vaultPath, ".gitmodules"), "utf8");
    expect(gitmodules).toContain('"assetspaces/kitelev/exoas-as2"');
    expect(gitmodules).toContain('"assetspaces/kitelev/exoas-as3"');
    expect(gitmodules).toContain('"assetspaces/kitelev/exoas-as1"'); // Phase 6: entry preserved post-destroy

    // ---- ASSERT cache contains as1 ----
    const cacheHas = await cacheLayer.has("as1");
    expect(cacheHas).toBe(true);

    // ---- ASSERT activeProfileUid persisted ----
    expect(localData.getActiveProfileUid()).toBe("profile-b");
    expect(localData.isSwitchInProgress()).toBe(false);

    // ---- Phase 6 AC2 — switch-back re-materializes from preserved .gitmodules ----
    // RFC 13da049f Phase 6.1 line 340: «re-switch к previously-destroyed profile
    // re-uses URL from `.gitmodules`». Switch profile-b → profile-a; as1 was
    // destroyed in profile-a→b transition but `.gitmodules` entry preserved.
    // Switch back must re-add as1 (URL recovered from `.gitmodules`).
    await mgr.applyProfile("profile-a");

    // After switch-back: as1 working tree restored, as3 destroyed.
    expect(existsSync(path.join(setup.vaultPath, "assetspaces/kitelev/exoas-as1"))).toBe(true);
    expect(existsSync(path.join(setup.vaultPath, "assetspaces/kitelev/exoas-as2"))).toBe(true);
    expect(existsSync(path.join(setup.vaultPath, "assetspaces/kitelev/exoas-as3"))).toBe(false);

    // `.gitmodules` still contains all three entries (URL registry).
    const gitmodulesAfter = await fs.readFile(path.join(setup.vaultPath, ".gitmodules"), "utf8");
    expect(gitmodulesAfter).toContain('"assetspaces/kitelev/exoas-as1"');
    expect(gitmodulesAfter).toContain('"assetspaces/kitelev/exoas-as2"');
    expect(gitmodulesAfter).toContain('"assetspaces/kitelev/exoas-as3"');

    // Active profile flipped back.
    expect(localData.getActiveProfileUid()).toBe("profile-a");
  }, 180_000);
});

/**
 * BootstrapAssetSpaceCommands — command-palette logic handler for RFC 13da049f
 * Phase 6.2 (Bootstrap vault) + Phase 6.3 (Add AssetSpace by URL), plugin side.
 *
 * Mirrors the CLI equivalents (`exocortex bootstrap` + `exocortex assetspace-add`,
 * v16.57.0) but runs inside Obsidian, reusing the Phase 5 plugin infrastructure
 * instead of duplicating the REST/tarball/security logic:
 *   - {@link IAssetSpacePuller.pullAssetSpace} (AssetSpaceManager) — REST tarball
 *     pull + zip-slip-safe extraction into a staging dir.
 *   - {@link IGitSubmoduleOps} (GitSubmoduleOps) — `renameIntoVault` (staging →
 *     vault) + `.gitmodules` read/append text manipulation.
 *
 * Pure logic — does NOT import Obsidian's Modal / Plugin / vault runtime.
 * Everything platform-specific (modal UI, vault.adapter probing, URL allowlist)
 * is injected via {@link BootstrapAssetSpaceCommandsDeps} so the class is fully
 * unit-testable with fakes. Real wiring lives in `ExocortexPlugin`.
 *
 * Desktop-only (Phase 6 scope, like Phase 5): the injected puller / gitOps throw
 * on mobile, and the plugin registers these commands only when desktop deps are
 * available.
 *
 * Commands provided:
 *   1. `Exocortex: Bootstrap vault` — cold-start an empty vault with the TS-floor
 *      AssetSpaces (exo + exocmd). Handles three vault states:
 *        - empty → prompt for exo + exocmd URLs (EC7: fields empty, kitelev URLs
 *          shown as placeholder examples only) → materialise both.
 *        - clone-needs-fetch (EC2) → `.gitmodules` populated but folders empty
 *          (cloned without `--recurse-submodules`) → confirm → re-materialise
 *          each tracked AssetSpace from its preserved URL.
 *        - bootstrapped → no-op notice (use «Add AssetSpace» for more spaces).
 *      Non-git vaults (AC10 / M19): file-only mode — REST pulls without
 *      `.gitmodules`, tracked device-locally.
 *   2. `Exocortex: Add AssetSpace by URL` — pull a single AssetSpace into a
 *      URL-derived folder, append the `.gitmodules` entry (idempotent).
 */

/** Subset of {@link AssetSpaceManager} used here (REST tarball pull). */
export interface IAssetSpacePuller {
  pullAssetSpace(
    asUid: string,
    asGitUrl: string,
    ref?: string,
  ): Promise<{ asUid: string; stagingPath: string; sha: string }>;
  /**
   * Release the staging dir returned by a prior {@link pullAssetSpace}. The
   * pull deliberately KEEPS the dir on success (caller owns its lifetime — see
   * `AssetSpaceManager.pullAssetSpace` docstring), so the caller MUST call this
   * once it has consumed the dir (moved it into the vault). Issue #3391:
   * without this the StagingDirTracker entry leaks into `data.local.json` until
   * the next plugin reload. Idempotent / tolerant of an already-moved dir.
   */
  releaseStaging(stagingPath: string): Promise<void>;
}

/** Subset of {@link GitSubmoduleOps} used here (staging move + `.gitmodules`). */
export interface IGitSubmoduleOps {
  renameIntoVault(stagingPath: string, submodulePath: string): Promise<void>;
  readGitmodulesEntries(): Promise<Array<{ submodulePath: string; url: string }>>;
  appendGitmodulesEntry(
    submodulePath: string,
    url: string,
  ): Promise<{ added: boolean }>;
}

/** Subset of {@link PluginLocalDataStore} used for AC10 file-only tracking. */
export interface IFileOnlyAssetSpaceStore {
  upsertFileOnlyAssetSpace(entry: {
    folderName: string;
    url: string;
    sha: string;
    addedAt: string;
  }): Promise<void>;
}

/** Result of a single AssetSpace materialisation. */
export interface MaterializeResult {
  /** Vault-relative folder the AssetSpace was materialised into. */
  folderName: string;
  /** 7-char tarball SHA recorded at pull time. */
  sha: string;
}

export interface BootstrapAssetSpaceCommandsDeps {
  /**
   * Lazily resolve the REST tarball puller. Invoked once per materialise (i.e.
   * at command-execution time, NOT at construction), so the puller is built
   * from the CURRENT GitHub PAT. Issue #3382: the previous fixed `puller`
   * captured an onload-time client, ignoring a PAT the user entered after the
   * plugin loaded → 401/404 on private-repo pulls. Production wiring resolves
   * this to {@link HardSwitchDepsFactory.buildAssetSpacePuller}.
   */
  getPuller: () => Promise<IAssetSpacePuller>;
  gitOps: IGitSubmoduleOps;
  localStore: IFileOnlyAssetSpaceStore;
  /** `vault.adapter.exists(path)` wrapper. */
  vaultExists: (path: string) => Promise<boolean>;
  /** `vault.adapter.list(dir)` wrapper. */
  listFolder: (
    dir: string,
  ) => Promise<{ files: string[]; folders: string[] }>;
  /** True when the vault root is a git repository (`.git` exists). */
  isGitVault: () => Promise<boolean>;
  /**
   * Validate a GitHub repo URL against the canonical allowlist. Throws on
   * invalid. Injected (not duplicated) so the single source of truth stays in
   * `GitHubRestClient.validateRepoURL`.
   */
  validateUrl: (url: string) => void;
  /**
   * Derive a folder name from a repo URL — strips the `exoas-` prefix
   * (`exoas-pmbok` → `pmbok`). Injected to avoid duplicating the URL parser.
   */
  deriveFolderName: (url: string) => string;
  /**
   * Open the bootstrap modal (two empty URL fields + example placeholders).
   * Resolves the entered URLs, or null if the user cancelled.
   */
  promptBootstrapUrls: () => Promise<{
    exoUrl: string;
    exocmdUrl: string;
  } | null>;
  /**
   * Open the add-AssetSpace modal (single URL field). Resolves the entered
   * URL, or null if the user cancelled.
   */
  promptAddAssetSpaceUrl: () => Promise<{ url: string } | null>;
  /** Yes/no confirmation gate (used by the EC2 clone-needs-fetch flow). */
  confirm: (message: string) => Promise<boolean>;
  /** User-facing Notice. */
  notify: (message: string) => void;
  /**
   * Optional hook fired after a successful materialisation so the plugin can
   * re-index the freshly added assets. Failures are swallowed (best-effort).
   */
  onMaterialized?: () => Promise<void>;
  /** Branch ref to pull from. Default `"main"`. */
  ref?: string;
}

/** TS-floor folders materialised by a cold bootstrap (fixed, mirrors CLI). */
const ASSETSPACES_DIR = "assetspaces";
const TS_FLOOR_EXO_PATH = `${ASSETSPACES_DIR}/exo`;
const TS_FLOOR_EXOCMD_PATH = `${ASSETSPACES_DIR}/exocmd`;

export type VaultBootstrapState =
  | "empty"
  | "bootstrapped"
  | "clone-needs-fetch";

export class BootstrapAssetSpaceCommands {
  private readonly d: BootstrapAssetSpaceCommandsDeps;
  private readonly ref: string;

  constructor(deps: BootstrapAssetSpaceCommandsDeps) {
    this.d = deps;
    this.ref = deps.ref ?? "main";
  }

  /**
   * Classify the current vault for the bootstrap command:
   *   - `empty` — no `.gitmodules` entries AND no materialised `assetspaces/*`.
   *   - `clone-needs-fetch` — `.gitmodules` has entries but no folder is
   *     materialised (EC2: cloned without `--recurse-submodules`).
   *   - `bootstrapped` — at least one `assetspaces/<ns>/` folder has content.
   */
  async detectVaultState(): Promise<VaultBootstrapState> {
    const entries = await this.d.gitOps.readGitmodulesEntries();
    const materialized = await this.hasMaterializedAssetSpaces();
    if (entries.length > 0) {
      return materialized ? "bootstrapped" : "clone-needs-fetch";
    }
    return materialized ? "bootstrapped" : "empty";
  }

  /** Command 1 — `Exocortex: Bootstrap vault`. */
  async invokeBootstrap(): Promise<void> {
    let state: VaultBootstrapState;
    try {
      state = await this.detectVaultState();
    } catch (e) {
      this.d.notify(`Bootstrap: could not inspect vault — ${this.msg(e)}`);
      return;
    }

    if (state === "bootstrapped") {
      this.d.notify(
        "Vault already has AssetSpaces materialised — use «Exocortex: Add AssetSpace by URL» to add more.",
      );
      return;
    }

    if (state === "clone-needs-fetch") {
      await this.fetchTrackedAssetSpaces();
      return;
    }

    // state === "empty" — prompt for the TS-floor URLs.
    const urls = await this.d.promptBootstrapUrls();
    if (urls === null) return; // user cancelled

    try {
      this.d.validateUrl(urls.exoUrl);
      this.d.validateUrl(urls.exocmdUrl);
    } catch (e) {
      this.d.notify(`Bootstrap: invalid URL — ${this.msg(e)}`);
      return;
    }

    const isGit = await this.d.isGitVault();
    if (!isGit) {
      this.d.notify(
        "Vault is not a git repository — bootstrapping in file-only mode (no .gitmodules; AssetSpaces tracked device-locally).",
      );
    }

    // Materialise exo then exocmd. If exocmd fails after exo succeeded, the
    // vault is half-bootstrapped: a re-run of «Bootstrap vault» would now
    // classify it as `bootstrapped` and refuse, so the recovery path (use
    // «Add assetspace by URL» for the missing floor) must be surfaced
    // explicitly here. Re-index either way so the part that landed is picked up.
    let exo: MaterializeResult | null = null;
    try {
      exo = await this.materialize(urls.exoUrl, TS_FLOOR_EXO_PATH, isGit);
      const exocmd = await this.materialize(
        urls.exocmdUrl,
        TS_FLOOR_EXOCMD_PATH,
        isGit,
      );
      this.d.notify(
        `Bootstrap complete — ${exo.folderName}@${exo.sha} + ${exocmd.folderName}@${exocmd.sha}. ` +
          "Reload Obsidian if the new assets do not appear. Add any further AssetSpaces manually — dependencies are not auto-resolved.",
      );
    } catch (e) {
      if (exo !== null) {
        this.d.notify(
          `Bootstrap partially completed — ${TS_FLOOR_EXO_PATH} materialised, but ${TS_FLOOR_EXOCMD_PATH} failed: ${this.msg(e)}. ` +
            "Use «Add assetspace by URL» to add the missing exocmd assetspace.",
        );
      } else {
        this.d.notify(`Bootstrap failed: ${this.msg(e)}`);
      }
      await this.runOnMaterialized();
      return;
    }
    await this.runOnMaterialized();
  }

  /** Command 2 — `Exocortex: Add AssetSpace by URL`. */
  async invokeAddAssetSpace(): Promise<void> {
    const res = await this.d.promptAddAssetSpaceUrl();
    if (res === null) return; // user cancelled

    try {
      this.d.validateUrl(res.url);
    } catch (e) {
      this.d.notify(`Add AssetSpace: invalid URL — ${this.msg(e)}`);
      return;
    }

    let folderName: string;
    try {
      folderName = this.d.deriveFolderName(res.url);
    } catch (e) {
      this.d.notify(`Add AssetSpace: could not derive folder — ${this.msg(e)}`);
      return;
    }

    const isGit = await this.d.isGitVault();
    if (!isGit) {
      this.d.notify(
        "Vault is not a git repository — adding in file-only mode (no .gitmodules; tracked device-locally).",
      );
    }

    try {
      const m = await this.materialize(
        res.url,
        `${ASSETSPACES_DIR}/${folderName}`,
        isGit,
      );
      this.d.notify(
        `AssetSpace added — ${m.folderName}@${m.sha} ← ${res.url}. ` +
          "Add any AssetSpaces it depends on manually — dependencies are not auto-resolved.",
      );
    } catch (e) {
      this.d.notify(`Add AssetSpace failed: ${this.msg(e)}`);
      return;
    }
    await this.runOnMaterialized();
  }

  // ─────────────────────────── internal ───────────────────────────

  /**
   * EC2 — re-materialise every `.gitmodules`-tracked AssetSpace whose folder is
   * currently empty (vault was cloned without `--recurse-submodules`). A git
   * clone always has a `.git` dir, so this path stays in git mode (the
   * `.gitmodules` entries already exist; `appendGitmodulesEntry` is a no-op).
   */
  private async fetchTrackedAssetSpaces(): Promise<void> {
    let entries: Array<{ submodulePath: string; url: string }>;
    try {
      entries = await this.d.gitOps.readGitmodulesEntries();
    } catch (e) {
      this.d.notify(`Bootstrap: could not read .gitmodules — ${this.msg(e)}`);
      return;
    }

    const ok = await this.d.confirm(
      `This vault tracks ${entries.length} AssetSpace(s) but none are materialised ` +
        "(likely cloned without --recurse-submodules). Fetch them now from the recorded URLs?",
    );
    if (!ok) return;

    let fetched = 0;
    for (const entry of entries) {
      if (entry.submodulePath.length === 0) continue;
      try {
        // Materialise into the exact path `.gitmodules` declares (preserves
        // any nested layout) rather than re-deriving from the basename.
        await this.materialize(entry.url, entry.submodulePath, true);
        fetched++;
      } catch (e) {
        this.d.notify(`Fetch failed for ${entry.submodulePath}: ${this.msg(e)}`);
      }
    }
    this.d.notify(
      `Fetched ${fetched}/${entries.length} AssetSpace(s) from recorded URLs.`,
    );
    if (fetched > 0) await this.runOnMaterialized();
  }

  /**
   * Pull `url`'s tarball into a staging dir, move it into the vault-relative
   * `submodulePath` (e.g. `assetspaces/exo`), then register it — append the
   * `.gitmodules` entry (git vault) OR record the file-only registry entry
   * (AC10 non-git vault). The staging-dir `asUid` label is synthetic
   * (`bootstrap-<basename>`) since a cold bootstrap has no AssetSpace UID yet —
   * it only names the temp dir for orphan tracking.
   */
  private async materialize(
    url: string,
    submodulePath: string,
    isGit: boolean,
  ): Promise<MaterializeResult> {
    // Resolve the puller lazily so the pull uses the PAT current at
    // command-execution time, not the one captured at plugin onload (#3382).
    const puller = await this.d.getPuller();
    const result = await puller.pullAssetSpace(
      `bootstrap-${basename(submodulePath)}`,
      url,
      this.ref,
    );
    await this.d.gitOps.renameIntoVault(result.stagingPath, submodulePath);
    // Issue #3391: `renameIntoVault` MOVED the staging dir into the vault, so
    // its StagingDirTracker entry now points at a path that no longer exists.
    // `pullAssetSpace` keeps the dir alive on success by design (caller owns
    // its lifetime) — release it here so the tracker entry does not linger in
    // `data.local.json` until the next reload. `release()` tolerates a missing
    // dir, so calling it after the move is safe; covers both this single-pull
    // path and the EC2 `fetchTrackedAssetSpaces` loop (which routes through
    // `materialize` too).
    await puller.releaseStaging(result.stagingPath);
    if (isGit) {
      await this.d.gitOps.appendGitmodulesEntry(submodulePath, url);
    } else {
      await this.d.localStore.upsertFileOnlyAssetSpace({
        folderName: submodulePath,
        url,
        sha: result.sha,
        addedAt: new Date().toISOString(),
      });
    }
    return { folderName: submodulePath, sha: result.sha };
  }

  /**
   * True when at least one `assetspaces/<ns>/` subfolder contains a `.md` file
   * (a proxy for «a materialised AssetSpace exists»). Missing `assetspaces/`
   * dir → false.
   */
  private async hasMaterializedAssetSpaces(): Promise<boolean> {
    const exists = await this.d.vaultExists(ASSETSPACES_DIR);
    if (!exists) return false;
    let top: { files: string[]; folders: string[] };
    try {
      top = await this.d.listFolder(ASSETSPACES_DIR);
    } catch {
      return false;
    }
    for (const folder of top.folders) {
      try {
        const inner = await this.d.listFolder(folder);
        if (inner.files.some((f) => f.endsWith(".md"))) return true;
      } catch {
        // Unreadable subfolder — ignore, keep scanning.
      }
    }
    return false;
  }

  private async runOnMaterialized(): Promise<void> {
    if (this.d.onMaterialized === undefined) return;
    try {
      await this.d.onMaterialized();
    } catch {
      // Best-effort re-index; failure must not surface as a bootstrap error.
    }
  }

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Last path segment of a `/`-delimited vault path (`"assetspaces/exo"` → `"exo"`). */
function basename(p: string): string {
  const norm = p.replace(/\/+$/, "");
  const idx = norm.lastIndexOf("/");
  return idx < 0 ? norm : norm.slice(idx + 1);
}

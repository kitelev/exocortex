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
 * Cross-platform (#3535): on DESKTOP the injected `getPuller` + `gitOps` run the
 * staging-pull + `.gitmodules` path (Node `fs`); on MOBILE an injected
 * {@link IRestBootstrapMount} (RFC 01a83de8 `RestAssetSpaceMount`) materialises
 * via `vault.adapter` (no Node `fs`). The plugin wires whichever is available
 * (`applyDeps` on desktop, `restMount` on mobile) and registers both commands on
 * both platforms — Desktop↔Mobile Command Parity invariant.
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

import { derivePath } from "exocortex";

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

/**
 * Cross-platform (incl. iOS) materialise + `.gitmodules` strategy — the
 * mobile-capable counterpart of {@link IAssetSpacePuller} + {@link IGitSubmoduleOps}
 * (#3535). A single combined op (pull tarball → materialise into the vault
 * folder → write `.gitmodules`) over `vault.adapter`, with NO Node `fs` /
 * staging dir / file-only registry split. Satisfied structurally by
 * `RestAssetSpaceMount` (RFC 01a83de8) — the same adapter that `apply-profile`
 * already mounts through on mobile.
 *
 * When injected, it fully replaces the desktop `getPuller` + `gitOps` path:
 * `.gitmodules` becomes the single source of truth that `apply-profile`
 * (`listAllAssetSpaceInfos`) reads, written regardless of `.git` presence (a
 * fresh mobile vault has no `.git`).
 */
export interface IRestBootstrapMount {
  /**
   * Pull `gitUrl`'s tarball, materialise it into `submodulePath`, and write the
   * `.gitmodules` entry — all via `vault.adapter`. Returns the tarball SHA.
   */
  mount(
    gitUrl: string,
    submodulePath: string,
    ref: string,
  ): Promise<{ sha: string }>;
  /** Read the current `.gitmodules` (path, url) entries via `vault.adapter`. */
  readGitmodulesEntries(): Promise<
    Array<{ submodulePath: string; url: string }>
  >;
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
   * this to {@link ApplyDepsFactory.buildAssetSpacePuller}.
   */
  getPuller?: () => Promise<IAssetSpacePuller>;
  gitOps?: IGitSubmoduleOps;
  localStore?: IFileOnlyAssetSpaceStore;
  /**
   * Mobile (#3535) cross-platform materialise strategy. When wired, it replaces
   * the desktop `getPuller` + `gitOps` path entirely (the REST mount does the
   * pull + materialise + `.gitmodules` write itself). Desktop wiring passes the
   * `getPuller` + `gitOps` + `localStore` trio (no `restMount`); mobile wiring
   * passes `restMount` (and may still pass `localStore`, which is unused on the
   * REST path). At least one of {`getPuller` + `gitOps`, `restMount`} must be
   * present, else `materialize` / `listTrackedEntries` throw.
   */
  restMount?: IRestBootstrapMount;
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
    const entries = await this.listTrackedEntries();
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

    // Core-only (RFC 5aa2a73a B3 / alt-G #3426): exo is the SDK floor; exocmd is
    // an OPTIONAL UI-command library. An empty exocmd URL yields a knowledge-only
    // vault and must be accepted as a first-class configuration.
    const wantExocmd = urls.exocmdUrl.trim().length > 0;
    try {
      this.d.validateUrl(urls.exoUrl);
      if (wantExocmd) this.d.validateUrl(urls.exocmdUrl);
    } catch (e) {
      this.d.notify(`Bootstrap: invalid URL — ${this.msg(e)}`);
      return;
    }

    const isGit = await this.d.isGitVault();
    // On mobile (restMount) the REST mount always writes `.gitmodules` via
    // vault.adapter regardless of `.git` presence (apply-profile reads it), so
    // the desktop "file-only mode" notice would be misleading — suppress it.
    if (!isGit && this.d.restMount === undefined) {
      this.d.notify(
        "Vault is not a git repository — bootstrapping in file-only mode (no .gitmodules; AssetSpaces tracked device-locally).",
      );
    }

    // Materialise exo then exocmd. If exocmd fails after exo succeeded, the
    // vault is half-bootstrapped: a re-run of «Bootstrap vault» would now
    // classify it as `bootstrapped` and refuse, so the recovery path (use
    // «Add assetspace by URL» for the missing floor) must be surfaced
    // explicitly here. Re-index either way so the part that landed is picked up.
    // RFC 5aa2a73a B4: mount the TS-floor at the Maven path
    // `assetspaces/<owner>/<repo>` — the SAME path `apply-profile` derives via
    // `derivePath`. Flat paths (`assetspaces/exo`) caused a later `apply-profile`
    // to re-materialize the same AssetSpace UID at the Maven path → double mount.
    // Fallback to the flat constant only when the URL is un-derivable.
    const exoPath = derivePath(urls.exoUrl) ?? TS_FLOOR_EXO_PATH;
    const exocmdPath = wantExocmd
      ? (derivePath(urls.exocmdUrl) ?? TS_FLOOR_EXOCMD_PATH)
      : TS_FLOOR_EXOCMD_PATH;
    let exo: MaterializeResult | null = null;
    try {
      exo = await this.materialize(urls.exoUrl, exoPath, isGit);
      if (wantExocmd) {
        const exocmd = await this.materialize(
          urls.exocmdUrl,
          exocmdPath,
          isGit,
        );
        this.d.notify(
          `Bootstrap complete — ${exo.folderName}@${exo.sha} + ${exocmd.folderName}@${exocmd.sha}. ` +
            "Reload Obsidian if the new assets do not appear. Add any further AssetSpaces manually — dependencies are not auto-resolved.",
        );
      } else {
        this.d.notify(
          `Bootstrap complete — ${exo.folderName}@${exo.sha} (knowledge-only, no exocmd). ` +
            "Reload Obsidian if the new assets do not appear. Add exocmd or any further AssetSpaces later via «Add assetspace by URL».",
        );
      }
    } catch (e) {
      if (exo !== null) {
        this.d.notify(
          `Bootstrap partially completed — ${exoPath} materialised, but ${exocmdPath} failed: ${this.msg(e)}. ` +
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

    // #3538: mount at the canonical Maven path `assetspaces/<owner>/<repo>` —
    // the SAME path `invokeBootstrap` (above) and `apply-profile`
    // (`ProfileApplyManager.listAllAssetSpaceInfos`) derive via `derivePath`.
    // Previously this used `deriveFolderName` → flat `assetspaces/<name>`,
    // disagreeing with bootstrap/apply on where the same repo lands: a later
    // `apply-profile` would not recognise the flat folder as materialised (it
    // checks the canonical `derivePath`) and re-materialise the same AssetSpace
    // UID at the Maven path → double mount. Fall back to the flat folder only
    // when the URL is un-derivable (`derivePath` → null), mirroring
    // `invokeBootstrap`'s `?? TS_FLOOR_*` fallback. Platform-agnostic — the
    // single `materialize` call below covers both the desktop (gitOps) and
    // mobile (restMount) paths.
    let submodulePath: string;
    try {
      submodulePath =
        derivePath(res.url) ??
        `${ASSETSPACES_DIR}/${this.d.deriveFolderName(res.url)}`;
    } catch (e) {
      this.d.notify(`Add AssetSpace: could not derive folder — ${this.msg(e)}`);
      return;
    }

    const isGit = await this.d.isGitVault();
    // See invokeBootstrap: the mobile REST path writes `.gitmodules` regardless,
    // so the desktop "file-only mode" notice does not apply.
    if (!isGit && this.d.restMount === undefined) {
      this.d.notify(
        "Vault is not a git repository — adding in file-only mode (no .gitmodules; tracked device-locally).",
      );
    }

    try {
      const m = await this.materialize(res.url, submodulePath, isGit);
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
      entries = await this.listTrackedEntries();
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
    // Mobile (#3535 / RFC 01a83de8): one cross-platform op — pull the tarball,
    // materialise it into the vault folder, and write the `.gitmodules` entry,
    // all via `vault.adapter` (no Node fs, no staging dir, no file-only
    // registry split). `.gitmodules` is the single source of truth that
    // apply-profile (`listAllAssetSpaceInfos`) reads, so it is written
    // regardless of the `isGit` flag (a fresh mobile vault has no `.git`).
    if (this.d.restMount !== undefined) {
      const { sha } = await this.d.restMount.mount(
        url,
        submodulePath,
        this.ref,
      );
      return { folderName: submodulePath, sha };
    }

    // Desktop path — staging tarball pull + rename-into-vault + `.gitmodules`
    // append (git vault) / file-only registry (AC10 non-git vault).
    const getPuller = this.d.getPuller;
    const gitOps = this.d.gitOps;
    const localStore = this.d.localStore;
    if (
      getPuller === undefined ||
      gitOps === undefined ||
      localStore === undefined
    ) {
      throw new Error(
        "BootstrapAssetSpaceCommands: desktop materialise requires getPuller + gitOps + localStore (or wire restMount for mobile)",
      );
    }
    // Resolve the puller lazily so the pull uses the PAT current at
    // command-execution time, not the one captured at plugin onload (#3382).
    const puller = await getPuller();
    const result = await puller.pullAssetSpace(
      `bootstrap-${basename(submodulePath)}`,
      url,
      this.ref,
    );
    await gitOps.renameIntoVault(result.stagingPath, submodulePath);
    // Issue #3391: `renameIntoVault` MOVED the staging dir into the vault, so
    // its StagingDirTracker entry now points at a path that no longer exists.
    // `pullAssetSpace` keeps the dir alive on success by design (caller owns
    // its lifetime) — release it here so the tracker entry does not linger in
    // `data.local.json` until the next reload. `release()` tolerates a missing
    // dir, so calling it after the move is safe; covers both this single-pull
    // path and the EC2 `fetchTrackedAssetSpaces` loop (which routes through
    // `materialize` too). Best-effort (`.catch`) — a release failure (e.g. a
    // `data.local.json` write error) must not skip the `.gitmodules` /
    // file-only registration below; a leaked tracker entry is benign and
    // self-heals via `sweepOrphans` on reload. Mirrors `pullAssetSpace`'s own
    // cleanup convention (`stagingTracker.release(...).catch(() => undefined)`).
    await puller.releaseStaging(result.stagingPath).catch(() => undefined);
    if (isGit) {
      await gitOps.appendGitmodulesEntry(submodulePath, url);
    } else {
      await localStore.upsertFileOnlyAssetSpace({
        folderName: submodulePath,
        url,
        sha: result.sha,
        addedAt: new Date().toISOString(),
      });
    }
    return { folderName: submodulePath, sha: result.sha };
  }

  /**
   * True when a materialised AssetSpace exists — at least one `.md` under either
   * the flat layout (`assetspaces/<ns>/*.md`) or the Maven layout
   * (`assetspaces/<owner>/<repo>/*.md`, RFC 5aa2a73a B4). Missing `assetspaces/`
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
        // Flat layout: `assetspaces/<ns>/*.md`.
        if (inner.files.some((f) => f.endsWith(".md"))) return true;
        // Maven layout (B4): the `.md` live one level deeper, under
        // `assetspaces/<owner>/<repo>/` — scan the owner folder's children too.
        for (const sub of inner.folders) {
          try {
            const deep = await this.d.listFolder(sub);
            if (deep.files.some((f) => f.endsWith(".md"))) return true;
          } catch {
            // Unreadable nested subfolder — ignore, keep scanning.
          }
        }
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

  /**
   * Read the `.gitmodules` (path, url) entries via whichever strategy is wired —
   * the mobile {@link IRestBootstrapMount} (vault.adapter) or the desktop
   * {@link IGitSubmoduleOps} (Node fs). Throws if neither is wired.
   */
  private async listTrackedEntries(): Promise<
    Array<{ submodulePath: string; url: string }>
  > {
    if (this.d.restMount !== undefined) {
      return this.d.restMount.readGitmodulesEntries();
    }
    if (this.d.gitOps !== undefined) {
      return this.d.gitOps.readGitmodulesEntries();
    }
    throw new Error(
      "BootstrapAssetSpaceCommands: neither restMount (mobile) nor gitOps (desktop) wired",
    );
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

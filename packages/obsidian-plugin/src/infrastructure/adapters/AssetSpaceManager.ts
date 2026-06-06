// Node.js builtins required for Phase 5 hard-switch staging dirs (RFC
// 22b50a17) — staging dirs live in `os.tmpdir()` OUTSIDE the vault so
// Obsidian's vault.adapter API cannot reach them. The `pullAssetSpace`
// entry point is guarded by `Platform.isMobile` throw — on mobile the
// code never executes (Phase 5 is desktop-only per RFC scope).
/* eslint-disable no-restricted-imports, import/no-nodejs-modules */
import { promises as fs } from "node:fs";
import * as path from "node:path";
/* eslint-enable no-restricted-imports, import/no-nodejs-modules */
import type { App, TFile } from "obsidian";
import { Platform } from "obsidian";
import type { INotificationService } from "exocortex";
import { derivePath } from "exocortex";
import { GitHubRestClient } from "./GitHubRestClient";
import { TarExtractor, type ExtractedTarFile } from "./TarExtractor";
import { StagingDirTracker } from "./StagingDirTracker";
import { lookupAssetSpaceUidByFolder } from "./AssetSpaceLookupHelper";
import {
  ASSET_SPACE_CLASS_UID,
  isAssetSpaceFrontmatter,
} from "./AssetSpaceFrontmatter";

// Re-export для backward-compat consumers that previously imported from
// `AssetSpaceManager` directly (e.g. existing test files); leaf-module
// authority lives in `AssetSpaceFrontmatter`.
export { ASSET_SPACE_CLASS_UID, isAssetSpaceFrontmatter };

/**
 * Resolved AssetSpace metadata extracted from vault frontmatter.
 */
export interface AssetSpaceInfo {
  uid: string;
  /** Repo URL — value of `exo__AssetSpace_source` (RFC v10) ?? legacy `exo__AssetSpace_git`. */
  git: string;
  /** Short name — value of `exo__AssetSpace_namespace`. */
  namespace: string;
  /**
   * Vault-relative folder path where AssetSpace files live, e.g.
   * `"assetspaces/ems"`. Derived from the path of the AssetSpace ABox
   * asset file (its parent directory).
   */
  folderName: string;
  /** Last-sync SHA — value of `exo__AssetSpace_lastPulledSha`, if recorded. */
  lastPulledSha?: string;
}

export interface AssetSpaceManagerOptions {
  app: App;
  client: GitHubRestClient;
  /**
   * User-notification surface. Required — push outcomes (success / no-op)
   * surface through `info()`. Inject `ObsidianNotificationService` in
   * production wiring; tests pass a fake to capture calls.
   */
  notifications: INotificationService;
  /** Git branch to push to. Default: `"main"`. */
  branch?: string;
  /**
   * Optional — TarExtractor used by {@link pullAssetSpace}. Defaults to a
   * fresh `new TarExtractor()`. Tests can inject a custom extractor to
   * stress зип-slip paths без round-tripping the singleton.
   */
  tarExtractor?: TarExtractor;
  /**
   * Optional — tracker для staging dirs created during pulls. Required
   * для `pullAssetSpace` to operate. If omitted, the call surface throws
   * a clear error before any side effects. Production wiring constructs
   * a tracker against {@link PluginLocalDataStore}.
   */
  stagingTracker?: StagingDirTracker;
}

/**
 * Outcome of a successful {@link AssetSpaceManager.pullAssetSpace} call —
 * tells the orchestrator (Phase 2 SwitchCacheLayer / Phase 3
 * `hardSwitchProfile`) where the freshly-materialised AssetSpace lives
 * on disk plus the SHA the GitHub REST tarball claimed.
 */
export interface PullAssetSpaceResult {
  /** AssetSpace UID that was pulled. */
  asUid: string;
  /**
   * Absolute path к staging directory containing the materialised
   * AssetSpace content (children of the GitHub tarball's wrapper dir
   * have been stripped — entries live directly at this path).
   */
  stagingPath: string;
  /**
   * 7-character SHA extracted from the GitHub tarball wrapper directory
   * name (`<owner>-<repo>-<sha7>/`). Used by Phase 2 SwitchCacheLayer to
   * key cache entries by content version.
   */
  sha: string;
}

/**
 * Operational manager for vault-cloned AssetSpaces (RFC 0a0791c1 Phase B.3).
 *
 * **v3 (backward-compat scope) — only push + lookup are operational.**
 * Pull / destroy / restore methods are kept on the surface for Phase C+D
 * stubs but throw `Phase C+D not implemented` so callers fail loudly rather
 * than silently no-op.
 *
 * ## Responsibilities
 *
 * 1. **Dirty-file tracking** — a plugin-managed `Set<vaultPath>` updated by
 *    the caller from a `vault.on("modify")` handler via {@link markDirty}.
 *    The manager itself does NOT subscribe to vault events (lifecycle is
 *    the plugin's concern). Single Set across all AssetSpaces; filtering
 *    by `folderName` happens at push time.
 * 2. **Push** — batch read every dirty file inside the AssetSpace's
 *    `folderName/` prefix, strip that prefix to obtain repo-relative
 *    paths, then call `GitHubRestClient.createCommit` (a 4-call REST
 *    chain). Update `exo__AssetSpace_lastPulledSha` post-commit.
 * 3. **Lookup** — given a folder name, return the AssetSpace UID that
 *    owns that folder (used by future UI surfaces to map open file →
 *    AssetSpace context).
 *
 * ## v3 Decisions (documented for handoff)
 *
 * - **lastPulledSha after push**: semantically `lastPulledSha` is "last
 *   pull SHA"; we also write it after push because pushing advances the
 *   local notion of "what remote contains". This is intentional drift
 *   from the property's literal name; renaming → see Phase D backlog.
 * - **Dirty Set lost on reload**: dirty state lives in memory only — closing
 *   Obsidian forgets which files are unpushed. Acceptable for v3 (manual
 *   push command, user-triggered). Future: persist in plugin `data.json`
 *   or compute from a real filesystem mtime / git working-tree diff.
 * - **Concurrent push race**: in-flight pushes are deduped via a
 *   `Map<asUid, Promise<string>>` — a second `pushAssetSpace(asUid)`
 *   while the first is still running reuses the same Promise. No
 *   cross-AssetSpace lock; simultaneous push of `ems` and `kpc` is fine.
 * - **Multi-vault (Vision Lock #11)**: this manager works on the active
 *   vault only. The plugin instantiates one manager per `App`. Pushing
 *   from one vault won't sync to the other — sibling vault must pull
 *   the same submodule commit through the standard 4-step chain.
 */
export class AssetSpaceManager {
  private readonly app: App;
  private readonly client: GitHubRestClient;
  private readonly notifications: INotificationService;
  private readonly branch: string;
  private readonly tarExtractor: TarExtractor;
  /**
   * Public read-only accessor — `FocusProfileSwitchManager.hardSwitchProfile`
   * (RFC 22b50a17 Phase 3) needs to release staging dirs on partial-fail
   * cleanup (R26). Stays nullable to preserve `pullAssetSpace`'s explicit
   * throw on `null` from Phase 1.
   */
  public readonly stagingTracker: StagingDirTracker | null;

  /**
   * Vault-relative paths of files modified since the last push. Plugin
   * populates via `markDirty` from a `vault.on("modify")` listener;
   * `pushAssetSpace` drains the subset matching the target AssetSpace's
   * `folderName/` prefix.
   */
  private readonly dirty = new Set<string>();

  /**
   * In-flight push dedup. Concurrent invocations for the same AssetSpace
   * UID return the same Promise so we don't fire two REST 4-call chains
   * over identical (and potentially racing) dirty snapshots.
   */
  private readonly inFlight = new Map<string, Promise<string | null>>();

  constructor(opts: AssetSpaceManagerOptions) {
    if (!opts || !opts.app) {
      throw new Error("AssetSpaceManager: app is required");
    }
    if (!opts.client) {
      throw new Error("AssetSpaceManager: client is required");
    }
    if (!opts.notifications) {
      throw new Error("AssetSpaceManager: notifications is required");
    }
    this.app = opts.app;
    this.client = opts.client;
    this.notifications = opts.notifications;
    this.branch = opts.branch ?? "main";
    this.tarExtractor = opts.tarExtractor ?? new TarExtractor();
    this.stagingTracker = opts.stagingTracker ?? null;
  }

  // ─────────────────────────── public — operational ───────────────────────────

  /**
   * Mark a vault path as dirty (modified since last push). Idempotent:
   * adding the same path twice has no effect. Path stays dirty until
   * `pushAssetSpace` succeeds for the AssetSpace owning that path.
   *
   * Intended caller: plugin's `vault.on("modify")` handler, e.g.
   *   `this.app.vault.on("modify", (file) => { if (file instanceof TFile)
   *      assetSpaceManager.markDirty(file.path); })`
   */
  public markDirty(vaultPath: string): void {
    if (typeof vaultPath !== "string" || vaultPath.length === 0) return;
    this.dirty.add(vaultPath);
  }

  /** Test/debug helper — current dirty-set snapshot. */
  public getDirtySnapshot(): ReadonlySet<string> {
    return new Set(this.dirty);
  }

  /**
   * Folder-name → AssetSpace UID lookup. Returns `null` if no AssetSpace
   * ABox asset owns this folder.
   *
   * The scan resolves AssetSpace assets by `exo__Instance_class` containing
   * the AssetSpace class UID. Folder ownership is derived from the parent
   * directory of the ABox asset's path — e.g. an asset at
   * `assetspaces/ems/f0f674da-....md` owns folder `"assetspaces/ems"`.
   */
  public lookupAssetSpaceForPath(folderName: string): string | null {
    return lookupAssetSpaceUidByFolder(this.app, folderName);
  }

  /**
   * Push all dirty files inside an AssetSpace's folder to the AssetSpace's
   * remote in a single commit.
   *
   * Steps (4 REST calls — see `GitHubRestClient.createCommit`):
   *   1. Resolve `AssetSpaceInfo` from vault frontmatter (UID, git, namespace, folder)
   *   2. Validate repo URL via the GitHub allowlist
   *   3. Pre-flight rate-limit gate (≥14 remaining = 4 push calls + 10 buffer)
   *   4. Collect dirty files in `folderName/` → repo-relative `Map<path,content>`
   *   5. `createCommit(owner, repo, branch, files, message)` → commit SHA
   *   6. Clear pushed paths from dirty set; write `exo__AssetSpace_lastPulledSha`
   *
   * Returns the commit SHA on success, or `null` if there is nothing to
   * push (no dirty files matched). Throws on validation / network /
   * lookup failures.
   *
   * Concurrent invocations for the same `asUid` reuse the in-flight Promise.
   */
  public pushAssetSpace(asUid: string): Promise<string | null> {
    if (typeof asUid !== "string" || asUid.length === 0) {
      // Reject via Promise.reject so the method stays non-async and
      // concurrent callers receive the literally-same Promise (===).
      return Promise.reject(new Error("pushAssetSpace: asUid is required"));
    }
    const existing = this.inFlight.get(asUid);
    if (existing) return existing;
    const promise = this.pushAssetSpaceInner(asUid).finally(() => {
      this.inFlight.delete(asUid);
    });
    this.inFlight.set(asUid, promise);
    return promise;
  }

  // ─────────────────────────── public — Phase 5 P1 ────────────────────────────

  /**
   * Pull the upstream tarball for an AssetSpace и materialise its contents
   * into a fresh staging directory.
   *
   * Steps:
   *   1. Validate the repo URL via {@link GitHubRestClient.validateRepoURL}.
   *   2. Allocate a staging dir via {@link StagingDirTracker} (registers
   *      orphan-cleanup record up front per RFC 22b50a17 R26).
   *   3. Fetch the raw tarball via
   *      {@link GitHubRestClient.fetchTarballBuffer} (50 MB cap by default).
   *   4. Extract every entry via {@link TarExtractor} (zip-slip safe — see
   *      F1 finding в Phase 0 spike doc) into the staging dir, stripping
   *      the GitHub-emitted wrapper `<owner>-<repo>-<sha7>/`.
   *   5. Return the staging path + SHA discovered from the wrapper.
   *
   * Wrapper-strip strategy (F1): GitHub REST tarballs always have a wrapper
   * directory matching `<owner>-<repo>-<sha7>/`. We discover the wrapper
   * from the first entry's leading segment, validate ALL entries share it
   * (defense-in-depth), then materialize using paths с the wrapper stripped.
   *
   * Cleanup contract: ANY error after staging-dir allocation triggers
   * `stagingTracker.release(stagingPath)` so we don't leak temp dirs.
   * Successful return KEEPS the staging dir — caller (Phase 2/3
   * orchestrators) owns its lifetime and must `release()` after the
   * downstream move-into-vault step succeeds OR fails.
   *
   * @throws desktop-only on mobile.
   * @throws if `stagingTracker` not provided to constructor.
   * @throws invalid URL / network failure / corrupt tarball / wrapper-shape
   *   mismatch — staging dir always released before propagation.
   */
  public async pullAssetSpace(
    asUid: string,
    asGitUrl: string,
    ref: string = "main",
  ): Promise<PullAssetSpaceResult> {
    if (Platform.isMobile) {
      throw new Error(
        "AssetSpaceManager.pullAssetSpace: desktop-only (Phase 5 limitation — mobile Obsidian has no fs / os.tmpdir).",
      );
    }
    if (!this.stagingTracker) {
      throw new Error(
        "AssetSpaceManager.pullAssetSpace: stagingTracker not configured (pass via options to enable Phase 5 pull).",
      );
    }
    if (typeof asUid !== "string" || asUid.length === 0) {
      throw new Error("pullAssetSpace: asUid is required");
    }
    if (typeof asGitUrl !== "string" || asGitUrl.length === 0) {
      throw new Error("pullAssetSpace: asGitUrl is required");
    }

    // Validate URL shape + extract owner/repo. validateRepoURL throws on
    // path traversal / scheme injection / non-github hosts.
    GitHubRestClient.validateRepoURL(asGitUrl);
    const { owner, repo } = parseGitHubURL(asGitUrl);

    // Pre-flight rate-limit gate. fetchTarballBuffer is a single REST call;
    // failing fast here saves us allocating staging dir on a doomed pull
    // (parallel to pushAssetSpace's `ensureRateLimit(4)` discipline).
    await this.client.ensureRateLimit(1);

    const stagingPath = await this.stagingTracker.allocate(asUid);
    try {
      const blob = await this.client.fetchTarballBuffer(owner, repo, ref);

      // Eagerly drain the iterable into an array so we can do the
      // two-pass wrapper-discover-then-strip pattern. Memory is already
      // O(tarball.size) because nanotar 0.3.0 buffers internally, so
      // collecting entry references adds only pointers, not bytes.
      const entries: ExtractedTarFile[] = [];
      for await (const entry of this.tarExtractor.extract(blob, {
        // Wrapper prefix unknown until we read the first entry — let
        // TarExtractor's prefix gate accept any path. Zip-slip protections
        // 1-3 (absolute paths, `..`, sym/hard links) remain active.
        stagingDirPrefix: "",
      })) {
        entries.push(entry);
      }
      if (entries.length === 0) {
        throw new Error(
          `pullAssetSpace: tarball empty for ${owner}/${repo}@${ref}`,
        );
      }

      const wrapper = discoverWrapperDir(entries);
      const sha = extractShaFromWrapper(wrapper);
      const wrapperPrefix = wrapper + "/";

      // Materialize entries with wrapper stripped.
      for (const entry of entries) {
        if (!entry.path.startsWith(wrapperPrefix)) {
          throw new Error(
            `pullAssetSpace: tarball entry "${entry.path}" not under wrapper "${wrapper}"`,
          );
        }
        const rel = entry.path.slice(wrapperPrefix.length);
        // Defensive: TarExtractor already skips directory-type entries
        // (TarExtractor.ts:152-155), but if a future regression yielded
        // an entry whose path equals the wrapper itself, `rel` would be
        // empty — skip rather than `fs.writeFile("")` an empty dir.
        if (rel.length === 0) continue;
        const target = path.join(stagingPath, rel);
        // Defense-in-depth: confirm the resolved target stays inside
        // staging — path.join with `..` segments would otherwise escape.
        // TarExtractor already rejects `..` segments, this is belt-and-
        // braces in case of future regression.
        const resolvedTarget = path.resolve(target);
        const resolvedStaging = path.resolve(stagingPath);
        if (
          resolvedTarget !== resolvedStaging &&
          !resolvedTarget.startsWith(resolvedStaging + path.sep)
        ) {
          throw new Error(
            `pullAssetSpace: resolved path "${resolvedTarget}" escapes staging dir`,
          );
        }
        await fs.mkdir(path.dirname(resolvedTarget), { recursive: true });
        await fs.writeFile(resolvedTarget, entry.content);
      }

      return { asUid, stagingPath, sha };
    } catch (err) {
      // Best-effort cleanup of the partially-populated staging dir.
      await this.stagingTracker
        .release(stagingPath)
        .catch(() => undefined);
      throw err;
    }
  }

  /**
   * Release a staging dir previously returned by {@link pullAssetSpace}. The
   * pull KEEPS the dir on success (caller owns its lifetime — see that method's
   * docstring), so the Bootstrap / Add-AssetSpace orchestrator calls this after
   * moving the dir into the vault (Issue #3391) so the tracker entry does not
   * leak. Delegates to {@link StagingDirTracker.release}, which tolerates an
   * already-removed dir. No-op when no tracker is wired (the pull path requires
   * one, so a release without a tracker is a benign mismatch, not an error).
   */
  public async releaseStaging(stagingPath: string): Promise<void> {
    await this.stagingTracker?.release(stagingPath);
  }

  // ─────────────────────────── public — stubs (Phase 2+3) ─────────────────────

  /** STUB — destroy deferred to Phase 2 SwitchCacheLayer / Phase 3 hardSwitchProfile. */
  public async destroyAssetSpace(_asUid: string): Promise<void> {
    throw new Error(
      "AssetSpaceManager.destroyAssetSpace: deferred to Phase 2/3 (RFC 22b50a17)",
    );
  }

  /** STUB — restore-from-cache deferred to Phase 2 SwitchCacheLayer. */
  public async restoreFromCache(_asUid: string): Promise<boolean> {
    throw new Error(
      "AssetSpaceManager.restoreFromCache: deferred to Phase 2 SwitchCacheLayer (RFC 22b50a17)",
    );
  }

  // ─────────────────────────── internal ───────────────────────────

  private async pushAssetSpaceInner(asUid: string): Promise<string | null> {
    const info = this.lookupAssetSpaceInfo(asUid);
    if (!info) {
      throw new Error(
        `pushAssetSpace: AssetSpace ${asUid} not found in vault TBox`,
      );
    }

    // Allowlist validation — throws on path-traversal / non-github / etc.
    GitHubRestClient.validateRepoURL(info.git);
    const { owner, repo } = parseGitHubURL(info.git);

    // Pre-flight rate-limit gate — createCommit makes 4 REST calls.
    await this.client.ensureRateLimit(4);

    const dirtyForAS = this.collectDirtyForAssetSpace(info);
    if (dirtyForAS.length === 0) {
      this.notifications.info(
        `AssetSpace ${info.namespace}: no dirty files to push`,
      );
      return null;
    }

    const files = new Map<string, string>();
    for (const vaultPath of dirtyForAS) {
      const content = await this.app.vault.adapter.read(vaultPath);
      const repoPath = stripFolderPrefix(vaultPath, info.folderName);
      files.set(repoPath, content);
    }

    const message = `chore(assetspace): push ${files.size} dirty file(s) via plugin push`;
    const sha = await this.client.createCommit(
      owner,
      repo,
      this.branch,
      files,
      message,
    );

    // Commit succeeded — persist sha FIRST, then clear pushed paths only on
    // success. Reversed order prevents a window where dirty entries are
    // cleared but `lastPulledSha` write throws (e.g. processFrontMatter
    // failure, file vanished mid-push): a retry would lose track of the
    // unpersisted files. See Issue #3312 HIGH push race.
    await this.updateLastPulledSha(asUid, sha);
    for (const vaultPath of dirtyForAS) this.dirty.delete(vaultPath);

    this.notifications.success(
      `AssetSpace ${info.namespace}: pushed ${files.size} file(s) → ${sha.slice(0, 7)}`,
    );
    return sha;
  }

  /**
   * Public for testability + future use by Cmd+P / settings UI surfaces.
   * Scans the entire vault — not the assumed `assetspaces/<ns>/` folder —
   * so a folder convention violation doesn't silently miss the asset.
   */
  public lookupAssetSpaceInfo(asUid: string): AssetSpaceInfo | null {
    if (typeof asUid !== "string" || asUid.length === 0) return null;
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.readFrontmatter(file);
      if (!fm) continue;
      if (fm["exo__Asset_uid"] !== asUid) continue;
      if (!isAssetSpaceFrontmatter(fm)) continue;
      // Dual-read `_source ?? _git` (RFC 01a83de8 v10 T3). The new
      // `exo__AssetSpace_source` supersedes legacy `_git`; both feed the same
      // `info.git` slot during the transition (Phase 1b retires `_git`).
      const source = typeof fm["exo__AssetSpace_source"] === "string"
        ? (fm["exo__AssetSpace_source"] as string)
        : "";
      const git = source || (typeof fm["exo__AssetSpace_git"] === "string"
        ? (fm["exo__AssetSpace_git"] as string)
        : "");
      const namespace = typeof fm["exo__AssetSpace_namespace"] === "string"
        ? (fm["exo__AssetSpace_namespace"] as string)
        : "";
      if (!git || !namespace) return null;
      // RFC 01a83de8 Phase 1b T3 — folder = AssetSpace mount path derived from
      // `_source` (`assetspaces/<owner>/<repo>`), not the descriptor file's
      // parent folder (post-migration the descriptor lives in the registry).
      // parentFolder remains a defensive fallback for unresolvable sources.
      const folderName = derivePath(git) ?? parentFolder(file.path);
      const lastPulledSha = typeof fm["exo__AssetSpace_lastPulledSha"] === "string"
        ? (fm["exo__AssetSpace_lastPulledSha"] as string)
        : undefined;
      return { uid: asUid, git, namespace, folderName, lastPulledSha };
    }
    return null;
  }

  private collectDirtyForAssetSpace(info: AssetSpaceInfo): string[] {
    const prefix = info.folderName.endsWith("/")
      ? info.folderName
      : info.folderName + "/";
    const out: string[] = [];
    for (const path of this.dirty) {
      if (path.startsWith(prefix)) out.push(path);
    }
    return out;
  }

  private async updateLastPulledSha(asUid: string, sha: string): Promise<void> {
    const file = this.findAssetSpaceFile(asUid);
    if (!file) {
      throw new Error(
        `updateLastPulledSha: AssetSpace ${asUid} file vanished mid-push`,
      );
    }
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm["exo__AssetSpace_lastPulledSha"] = sha;
      fm["exo__Asset_updatedAt"] = nowIsoSeconds();
    });
  }

  private findAssetSpaceFile(asUid: string): TFile | null {
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.readFrontmatter(file);
      if (!fm) continue;
      if (fm["exo__Asset_uid"] === asUid && isAssetSpaceFrontmatter(fm)) {
        return file;
      }
    }
    return null;
  }

  private readFrontmatter(file: TFile): Record<string, unknown> | null {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache || !cache.frontmatter) return null;
    return cache.frontmatter as Record<string, unknown>;
  }
}

// ────────────────────────── module-private helpers ──────────────────────────
// Shared predicates / constants (ASSET_SPACE_CLASS_UID, isAssetSpaceFrontmatter,
// WIKILINK_UID_RE) live in `AssetSpaceFrontmatter` (leaf module) to break
// the AssetSpaceManager ↔ AssetSpaceLookupHelper circular import.

function parentFolder(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx < 0 ? "" : filePath.slice(0, idx);
}

function stripFolderPrefix(vaultPath: string, folderName: string): string {
  const prefix = folderName.endsWith("/") ? folderName : folderName + "/";
  if (!vaultPath.startsWith(prefix)) {
    throw new Error(
      `stripFolderPrefix: path "${vaultPath}" not under folder "${folderName}"`,
    );
  }
  return vaultPath.slice(prefix.length);
}

/**
 * Parse a vault-declared GitHub repo URL into `owner/repo` segments. The URL
 * has already been validated by `GitHubRestClient.validateRepoURL`, so this
 * function only does the structural split. Throws if shape unexpectedly
 * differs (defensive — should be unreachable post-validation).
 *
 * Exported for unit test only.
 */
export function parseGitHubURL(url: string): { owner: string; repo: string } {
  const m = url.match(
    /^https:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/,
  );
  if (!m) {
    throw new Error(`parseGitHubURL: invalid URL shape: ${url}`);
  }
  return { owner: m[1], repo: m[2] };
}

/**
 * Discover the wrapper directory of a GitHub REST tarball.
 *
 * GitHub generates tarballs с inherent wrapper `<owner>-<repo>-<sha7>/`.
 * Every entry's path starts с this prefix. We read the first segment of
 * the first entry, then verify ALL entries share it.
 *
 * Empty / null entry name (already rejected by TarExtractor.validateEntry)
 * would surface here as a missing slash, which we treat as a malformed
 * tarball.
 *
 * Exported for unit testing.
 */
export function discoverWrapperDir(entries: ExtractedTarFile[]): string {
  if (entries.length === 0) {
    throw new Error("discoverWrapperDir: cannot discover wrapper of empty entry list");
  }
  const first = entries[0].path;
  const slashIdx = first.indexOf("/");
  // Tarball without any `/` means a top-level file with no wrapper —
  // shape inconsistent with GitHub REST contract.
  if (slashIdx < 0) {
    throw new Error(
      `discoverWrapperDir: expected wrapper directory, entry "${first}" has no path separator`,
    );
  }
  const wrapper = first.slice(0, slashIdx);
  if (wrapper.length === 0) {
    throw new Error(
      `discoverWrapperDir: empty wrapper segment in entry "${first}"`,
    );
  }
  const wrapperPrefix = wrapper + "/";
  for (const entry of entries) {
    // Allow exact match (the wrapper dir itself listed как entry).
    if (entry.path === wrapper || entry.path === wrapperPrefix) continue;
    if (!entry.path.startsWith(wrapperPrefix)) {
      throw new Error(
        `discoverWrapperDir: entry "${entry.path}" not under wrapper "${wrapper}"`,
      );
    }
  }
  return wrapper;
}

/**
 * Extract the commit SHA from a GitHub REST tarball wrapper name.
 *
 * GitHub-emitted wrapper names follow the pattern `<owner>-<repo>-<sha>`
 * where `<sha>` is the last `-`-delimited segment. **The SHA length depends on
 * authentication:** ANONYMOUS tarball requests get a 7-char abbreviated SHA,
 * but AUTHENTICATED requests (private repos, PAT supplied) get the FULL 40-char
 * SHA. Accepting only 7 chars broke private-repo pulls — the full-SHA wrapper
 * failed this match and the whole pull threw. Repo names CAN contain hyphens,
 * so we anchor on the trailing hex segment (7..40 chars) to avoid
 * `<owner>-<repo-with-dash>-<sha>` ambiguity.
 *
 * Exported for unit testing.
 */
export function extractShaFromWrapper(wrapper: string): string {
  // Trailing `-<hex>` suffix, 7 (abbreviated) to 40 (full) hex chars. Hex is
  // case-insensitive in principle but GitHub emits lowercase.
  const m = wrapper.match(/-([0-9a-fA-F]{7,40})$/);
  if (!m) {
    throw new Error(
      `extractShaFromWrapper: wrapper "${wrapper}" does not match expected GitHub pattern <owner>-<repo>-<sha>`,
    );
  }
  return m[1].toLowerCase();
}

function nowIsoSeconds(): string {
  // Append explicit `Z` UTC suffix — `toISOString().slice(0, 19)` drops the
  // `.sssZ` tail and yields `YYYY-MM-DDTHH:mm:ss`, which leading consumers
  // read as local-time. Vault convention is explicit UTC. See Issue #3312
  // MEDIUM #2.
  return new Date().toISOString().slice(0, 19) + "Z";
}

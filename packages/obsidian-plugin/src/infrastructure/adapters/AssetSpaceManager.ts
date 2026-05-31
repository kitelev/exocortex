import type { App, TFile } from "obsidian";
import type { INotificationService } from "exocortex";
import { GitHubRestClient } from "./GitHubRestClient";

/**
 * Class UID of `exo__AssetSpace` (TBox root). Used to discriminate AssetSpace
 * ABox instances from other assets when scanning the vault. Hardcoded by RFC
 * 0a0791c1 (UID frozen by RFC v2 `2a98f345`, implemented 2026-05-17).
 */
export const ASSET_SPACE_CLASS_UID = "73bd00e4-ccc0-4f3f-b20d-c4388c4588fb";

/**
 * Resolved AssetSpace metadata extracted from vault frontmatter.
 */
export interface AssetSpaceInfo {
  uid: string;
  /** Repo URL — value of `exo__AssetSpace_git`. */
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
    if (typeof folderName !== "string" || folderName.length === 0) {
      return null;
    }
    const normalized = stripTrailingSlash(folderName);
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.readFrontmatter(file);
      if (!fm) continue;
      if (!isAssetSpaceFrontmatter(fm)) continue;
      const parent = parentFolder(file.path);
      if (parent === normalized) {
        const uid = fm["exo__Asset_uid"];
        if (typeof uid === "string" && uid.length > 0) return uid;
      }
    }
    return null;
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

  // ─────────────────────────── public — stubs (Phase C+D) ─────────────────────

  /** STUB — pull live-load deferred to Phase C+D per RFC 0a0791c1 §Scope. */
  public async pullAssetSpace(_asUid: string, _stagingDir: string): Promise<void> {
    throw new Error(
      "AssetSpaceManager.pullAssetSpace: Phase C+D not implemented (v3 scope = push + lookup only)",
    );
  }

  /** STUB — destroy deferred to Phase C+D. */
  public async destroyAssetSpace(_asUid: string): Promise<void> {
    throw new Error(
      "AssetSpaceManager.destroyAssetSpace: Phase C+D not implemented (v3 scope = push + lookup only)",
    );
  }

  /** STUB — restore-from-cache deferred to Phase C+D. */
  public async restoreFromCache(_asUid: string): Promise<boolean> {
    throw new Error(
      "AssetSpaceManager.restoreFromCache: Phase C+D not implemented (v3 scope = push + lookup only)",
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

    // Commit succeeded — clear pushed paths from dirty set, persist sha.
    for (const vaultPath of dirtyForAS) this.dirty.delete(vaultPath);
    await this.updateLastPulledSha(asUid, sha);

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
      const git = typeof fm["exo__AssetSpace_git"] === "string"
        ? (fm["exo__AssetSpace_git"] as string)
        : "";
      const namespace = typeof fm["exo__AssetSpace_namespace"] === "string"
        ? (fm["exo__AssetSpace_namespace"] as string)
        : "";
      if (!git || !namespace) return null;
      const folderName = parentFolder(file.path);
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

/**
 * Predicate — does this frontmatter declare `exo__Instance_class` containing
 * the AssetSpace class UID? Handles both wikilink-string and array-of-string
 * shapes that Obsidian's parser may produce.
 */
function isAssetSpaceFrontmatter(fm: Record<string, unknown>): boolean {
  const classes = fm["exo__Instance_class"];
  const candidates: unknown[] = Array.isArray(classes) ? classes : [classes];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    if (c.includes(ASSET_SPACE_CLASS_UID)) return true;
  }
  return false;
}

function parentFolder(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx < 0 ? "" : filePath.slice(0, idx);
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
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

function nowIsoSeconds(): string {
  return new Date().toISOString().slice(0, 19);
}

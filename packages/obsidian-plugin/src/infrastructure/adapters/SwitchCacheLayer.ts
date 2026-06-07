// Node.js builtins required for switch-cache directory ops outside the
// Obsidian vault — RFC 22b50a17 §Key sub-systems B.5. Default cache root
// is `~/Library/Caches/exocortex/switch-cache/` (macOS desktop). Obsidian's
// `vault.adapter` API only addresses vault-relative paths, so OS-level
// caches must use Node directly. Mobile is guarded by `Platform.isMobile`
// throw at every public entry point — Phase 5 hard switch is desktop-only.
/* eslint-disable no-restricted-imports, import/no-nodejs-modules */
import { promises as fsPromises } from "node:fs";
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { randomBytes } from "node:crypto";
/* eslint-enable no-restricted-imports, import/no-nodejs-modules */
import { Platform } from "obsidian";
import { createTarGzip, parseTarGzip, type TarFileInput } from "nanotar";

/**
 * SwitchCacheLayer — filesystem-backed AssetSpace snapshot cache for
 * Profile hard switch (RFC 22b50a17 §Key sub-systems B.5).
 *
 * Layout (Decision #6 — wipe-all retention model):
 *   <cacheDir>/<asUid>/<sha>.tar.gz   — gzip tarball (F1 content-root convention)
 *   <cacheDir>/<asUid>/<sha>.meta.json — sidecar { asUid, sha, cachedAt, sizeBytes }
 *
 * Default cacheDir = `~/Library/Caches/exocortex/switch-cache/` (macOS desktop).
 * Constructor accepts a `cacheDir` override for test injection.
 *
 * Three invariants:
 *   F1  — Cache-side content-root: tarball entries are `a.md`, `subdir/b.md`
 *         (no wrapper directory). Restore writes them directly under the
 *         target dir — NO path-stripping needed (would yield empty target).
 *   F6  — verify-before-return: after archive write, `cache()` checks file
 *         exists + non-empty + parseable + non-zero entries. Failure throws
 *         CacheWriteError BEFORE caller proceeds to destroy uncached data.
 *   R28 — SHA-aware: sidecar stores SHA + cachedAt. `has(uid, sha)` answers
 *         "is THIS revision cached" so caller can fall back к fresh pull if
 *         upstream HEAD moved.
 *
 * Mobile: every public entry point throws via `Platform.isMobile` — Phase 5
 * hard switch is desktop-only (depends on git submodule ops + Node fs).
 *
 * Sync `getCacheStats()` is preserved for the v3 Settings UI render-path
 * (`ExocortexSettingTab.renderProfileSections`). Reads cache dir
 * synchronously — fast enough for the small entry counts expected.
 */

export interface CacheEntry {
  asUid: string;
  sha: string;
  /** ISO-8601 timestamp when archive was written. */
  cachedAt: string;
  sizeBytes: number;
}

export interface CacheStats {
  /** Number of cached tarballs across all AssetSpace dirs. */
  count: number;
  /** Aggregate byte size of all cached tarballs. */
  totalSize: number;
  /** ISO timestamp of the oldest entry's `cachedAt`, or null if empty. */
  oldestEntry: string | null;
}

export interface ICacheLayer {
  cache(asUid: string, sourceDir: string, sha: string): Promise<CacheEntry>;
  has(asUid: string, expectedSha?: string): Promise<boolean>;
  restore(asUid: string, targetDir: string): Promise<{ sha: string }>;
  clear(): Promise<{ entriesRemoved: number }>;
  listEntries(): Promise<ReadonlyArray<CacheEntry>>;
  getCacheDir(): string;
  getCacheStats(): CacheStats;
}

export interface SwitchCacheLayerOptions {
  /** Override cache root directory (test injection). */
  cacheDir?: string;
}

export class CacheWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CacheWriteError";
  }
}

export class CacheMissError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CacheMissError";
  }
}

export class SwitchCacheLayer implements ICacheLayer {
  private readonly cacheDir: string;

  constructor(options: SwitchCacheLayerOptions = {}) {
    this.cacheDir =
      options.cacheDir ??
      path.join(os.homedir(), "Library", "Caches", "exocortex", "switch-cache");
  }

  getCacheDir(): string {
    return this.cacheDir;
  }

  /**
   * Archive `sourceDir` content into `<cacheDir>/<asUid>/<sha>.tar.gz` plus
   * sidecar meta. Verifies the archive parses + is non-empty BEFORE returning
   * — caller depends on this contract (F6).
   *
   * @throws CacheWriteError if archive write failed in any verifiable way.
   */
  async cache(
    asUid: string,
    sourceDir: string,
    sha: string,
  ): Promise<CacheEntry> {
    this.assertDesktop("cache");
    if (!existsSync(sourceDir)) {
      throw new CacheWriteError(`Source directory does not exist: ${sourceDir}`);
    }
    const cachePath = this.getCachePath(asUid, sha);
    const metaPath = this.getMetaPath(asUid, sha);
    await fsPromises.mkdir(path.dirname(cachePath), { recursive: true });

    // Build tar input list with content-root convention (entries like
    // "a.md", "subdir/b.md" — no wrapper directory).
    let inputs: TarFileInput[];
    try {
      inputs = await this.collectTarInputs(sourceDir);
    } catch (err) {
      throw new CacheWriteError(
        `Failed to enumerate source ${sourceDir}: ${errorMessage(err)}`,
      );
    }

    let archive: Uint8Array;
    try {
      archive = await createTarGzip(inputs);
    } catch (err) {
      throw new CacheWriteError(
        `tar create failed for ${asUid}@${sha}: ${errorMessage(err)}`,
      );
    }

    // Atomic write: tmp + rename. POSIX rename is atomic — eliminates
    // partial-cache-on-crash class (MEDIUM-2 from code-review). Tmp paths
    // use random suffix so concurrent cache() calls on the same uid+sha
    // don't clobber each other's in-flight writes.
    const tmpSuffix = `.tmp-${Date.now()}-${randomBytes(6).toString("hex")}`;
    const cacheTmpPath = `${cachePath}${tmpSuffix}`;
    const metaTmpPath = `${metaPath}${tmpSuffix}`;

    try {
      await fsPromises.writeFile(cacheTmpPath, archive);
    } catch (err) {
      await fsPromises.rm(cacheTmpPath, { force: true }).catch(() => undefined);
      throw new CacheWriteError(
        `Cache file write failed for ${cacheTmpPath}: ${errorMessage(err)}`,
      );
    }

    // F6: verify-before-return on tmp file. Single `readFile` instead of
    // `stat` then `readFile` to close the TOCTOU window flagged by CodeQL
    // `js/file-system-race` (Issue #3336). `sizeBytes` is derived from the
    // buffer length, identical to `stat.size` for regular files.
    let buf: Buffer;
    try {
      buf = await fsPromises.readFile(cacheTmpPath);
    } catch (err) {
      await fsPromises.rm(cacheTmpPath, { force: true }).catch(() => undefined);
      throw new CacheWriteError(
        `Cannot read cache tmp ${cacheTmpPath}: ${errorMessage(err)}`,
      );
    }
    const sizeBytes = buf.length;
    if (sizeBytes === 0) {
      await fsPromises.rm(cacheTmpPath, { force: true }).catch(() => undefined);
      throw new CacheWriteError(`Cache file empty: ${cacheTmpPath}`);
    }
    // Verify archive parses + has non-zero entries — using the buffer just
    // read above. Catches post-write filesystem corruption (write returned
    // success but the bytes that landed on disk don't form a valid tar.gz).
    try {
      const parsed = await parseTarGzip(buf);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        await fsPromises.rm(cacheTmpPath, { force: true }).catch(() => undefined);
        throw new CacheWriteError(
          `Cache archive has no entries: ${cacheTmpPath}`,
        );
      }
    } catch (err) {
      if (err instanceof CacheWriteError) throw err;
      await fsPromises.rm(cacheTmpPath, { force: true }).catch(() => undefined);
      throw new CacheWriteError(
        `Cache archive corrupted: ${errorMessage(err)}`,
      );
    }

    const entry: CacheEntry = {
      asUid,
      sha,
      cachedAt: new Date().toISOString(),
      sizeBytes,
    };
    // Write sidecar tmp file FIRST — fails fast if filesystem is broken
    // before we touch the cache final path.
    try {
      await fsPromises.writeFile(
        metaTmpPath,
        JSON.stringify(entry, null, 2),
        "utf8",
      );
    } catch (err) {
      await fsPromises.rm(cacheTmpPath, { force: true }).catch(() => undefined);
      throw new CacheWriteError(
        `Sidecar meta write failed for ${metaTmpPath}: ${errorMessage(err)}`,
      );
    }
    // Atomic-rename phase: tar first, then sidecar. has(uid, sha) is
    // sidecar-gated (see has() impl), so until the sidecar rename lands
    // the entry is invisible to consumers — preserves has()↔restore()
    // consistency invariant (MEDIUM-1 from code-review).
    try {
      await fsPromises.rename(cacheTmpPath, cachePath);
    } catch (err) {
      await fsPromises.rm(cacheTmpPath, { force: true }).catch(() => undefined);
      await fsPromises.rm(metaTmpPath, { force: true }).catch(() => undefined);
      throw new CacheWriteError(
        `Atomic rename cache tmp→final failed: ${errorMessage(err)}`,
      );
    }
    try {
      await fsPromises.rename(metaTmpPath, metaPath);
    } catch (err) {
      // Sidecar rename failed — tar already at final path. Best-effort
      // rollback: remove tar + meta tmp. has() will report false (sidecar
      // missing); next cache() call overwrites cleanly.
      await fsPromises.rm(cachePath, { force: true }).catch(() => undefined);
      await fsPromises.rm(metaTmpPath, { force: true }).catch(() => undefined);
      throw new CacheWriteError(
        `Atomic rename sidecar tmp→final failed: ${errorMessage(err)}`,
      );
    }
    return entry;
  }

  /**
   * Check whether `asUid` has any cached entry. If `expectedSha` is given,
   * answers only for that specific revision (R28 — SHA-aware).
   *
   * Sidecar-gated: a cached entry is considered present ONLY when BOTH
   * tarball and sidecar meta exist. This keeps `has()` and `restore()`
   * truth-aligned — restore() skips entries without valid sidecars
   * (line 270 sibling check), so has() must agree to avoid surprising the
   * caller с a true→CacheMissError flip.
   */
  async has(asUid: string, expectedSha?: string): Promise<boolean> {
    this.assertDesktop("has");
    if (expectedSha !== undefined) {
      return (
        existsSync(this.getCachePath(asUid, expectedSha)) &&
        existsSync(this.getMetaPath(asUid, expectedSha))
      );
    }
    const dir = path.join(this.cacheDir, asUid);
    if (!existsSync(dir)) return false;
    try {
      const entries = await fsPromises.readdir(dir);
      // An asUid has a valid cache entry iff at least one `<sha>.tar.gz`
      // has a matching `<sha>.meta.json` sibling.
      const tarballShas = new Set<string>();
      const metaShas = new Set<string>();
      for (const e of entries) {
        if (e.endsWith(".tar.gz")) tarballShas.add(e.slice(0, -".tar.gz".length));
        else if (e.endsWith(".meta.json"))
          metaShas.add(e.slice(0, -".meta.json".length));
      }
      for (const sha of tarballShas) {
        if (metaShas.has(sha)) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Extract the newest-by-cachedAt cached tarball for `asUid` to `targetDir`.
   * Files land directly under `targetDir/<file>` (F1 — no wrapper directory
   * to strip).
   *
   * @throws CacheMissError if no cached entries exist.
   */
  async restore(
    asUid: string,
    targetDir: string,
  ): Promise<{ sha: string }> {
    this.assertDesktop("restore");
    const dir = path.join(this.cacheDir, asUid);
    if (!existsSync(dir)) {
      throw new CacheMissError(`No cache entries для ${asUid}`);
    }
    let files: string[];
    try {
      files = await fsPromises.readdir(dir);
    } catch (err) {
      throw new CacheMissError(
        `Cannot read cache dir ${dir}: ${errorMessage(err)}`,
      );
    }
    const metaFiles = files.filter((f) => f.endsWith(".meta.json"));
    if (metaFiles.length === 0) {
      throw new CacheMissError(`No cache entries для ${asUid}`);
    }
    const entries: CacheEntry[] = [];
    for (const metaFile of metaFiles) {
      const metaPath = path.join(dir, metaFile);
      try {
        const raw = await fsPromises.readFile(metaPath, "utf8");
        const parsed = JSON.parse(raw) as CacheEntry;
        if (
          typeof parsed?.asUid === "string" &&
          typeof parsed?.sha === "string" &&
          typeof parsed?.cachedAt === "string"
        ) {
          // Sanity check: tarball must still exist next to the sidecar.
          if (existsSync(this.getCachePath(parsed.asUid, parsed.sha))) {
            entries.push(parsed);
          }
        }
      } catch {
        // Skip unreadable / malformed sidecars; keep scanning.
      }
    }
    if (entries.length === 0) {
      throw new CacheMissError(
        `No valid cache entries found для ${asUid} (sidecars unreadable or orphaned)`,
      );
    }
    entries.sort((a, b) => b.cachedAt.localeCompare(a.cachedAt));
    const newest = entries[0];

    await fsPromises.mkdir(targetDir, { recursive: true });
    const archive = await fsPromises.readFile(
      this.getCachePath(newest.asUid, newest.sha),
    );
    let parsed;
    try {
      parsed = await parseTarGzip(archive);
    } catch (err) {
      throw new CacheMissError(
        `Failed to parse cached archive для ${asUid}@${newest.sha}: ${errorMessage(err)}`,
      );
    }
    // F1: write entries directly under targetDir — no strip required.
    for (const item of parsed) {
      if (!item.name) continue;
      // Reject absolute paths / `..` traversal / backslashes — nanotar
      // already normalises but defense-in-depth is cheap (mirrors
      // TarExtractor's zip-slip guard). Check `..` as a path SEGMENT, not
      // substring — `foo..bar.md` is a legitimate filename.
      const segments = item.name.split("/");
      if (
        item.name.startsWith("/") ||
        segments.includes("..") ||
        item.name.includes("\\")
      ) {
        throw new CacheMissError(
          `Unsafe entry path в cached archive: ${item.name}`,
        );
      }
      const destPath = path.join(targetDir, item.name);
      const normalisedDest = path.resolve(destPath);
      const normalisedTarget = path.resolve(targetDir);
      if (!normalisedDest.startsWith(normalisedTarget + path.sep) && normalisedDest !== normalisedTarget) {
        throw new CacheMissError(
          `Cache restore would escape target dir: ${item.name}`,
        );
      }
      if (item.type === "directory") {
        await fsPromises.mkdir(destPath, { recursive: true });
        continue;
      }
      await fsPromises.mkdir(path.dirname(destPath), { recursive: true });
      if (item.data) {
        await fsPromises.writeFile(destPath, item.data);
      } else {
        // File entry с no data — write empty file (rare, but safe).
        await fsPromises.writeFile(destPath, new Uint8Array(0));
      }
    }
    return { sha: newest.sha };
  }

  /**
   * Remove ALL cached entries across ALL AssetSpace dirs (Decision #6
   * wipe-all semantics). Returns count of removed `.tar.gz` files.
   */
  async clear(): Promise<{ entriesRemoved: number }> {
    this.assertDesktop("clear");
    if (!existsSync(this.cacheDir)) return { entriesRemoved: 0 };
    let removed = 0;
    let asUidDirs: string[];
    try {
      asUidDirs = await fsPromises.readdir(this.cacheDir);
    } catch {
      return { entriesRemoved: 0 };
    }
    for (const name of asUidDirs) {
      const fullDir = path.join(this.cacheDir, name);
      let isDir: boolean;
      try {
        const stat = await fsPromises.stat(fullDir);
        isDir = stat.isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;
      try {
        const entries = await fsPromises.readdir(fullDir);
        const tarballs = entries.filter((f) => f.endsWith(".tar.gz"));
        removed += tarballs.length;
        await fsPromises.rm(fullDir, { recursive: true, force: true });
      } catch {
        // Best-effort: skip dirs we cannot remove (permissions, etc.).
      }
    }
    return { entriesRemoved: removed };
  }

  /**
   * List all cache entries across all AssetSpace dirs. Useful для UI
   * confirm dialogs (preview before clear) and tests.
   */
  async listEntries(): Promise<ReadonlyArray<CacheEntry>> {
    this.assertDesktop("listEntries");
    if (!existsSync(this.cacheDir)) return [];
    let asUidDirs: string[];
    try {
      asUidDirs = await fsPromises.readdir(this.cacheDir);
    } catch {
      return [];
    }
    const all: CacheEntry[] = [];
    for (const name of asUidDirs) {
      const fullDir = path.join(this.cacheDir, name);
      let isDir: boolean;
      try {
        const stat = await fsPromises.stat(fullDir);
        isDir = stat.isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;
      let files: string[];
      try {
        files = await fsPromises.readdir(fullDir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith(".meta.json")) continue;
        try {
          const raw = await fsPromises.readFile(path.join(fullDir, f), "utf8");
          const parsed = JSON.parse(raw) as CacheEntry;
          if (
            typeof parsed?.asUid === "string" &&
            typeof parsed?.sha === "string" &&
            typeof parsed?.cachedAt === "string" &&
            typeof parsed?.sizeBytes === "number"
          ) {
            all.push(parsed);
          }
        } catch {
          // Skip malformed sidecar.
        }
      }
    }
    return all;
  }

  /**
   * Synchronous stats snapshot for the v3 Settings UI display path
   * (`ExocortexSettingTab.renderProfileSections` builds its widget
   * synchronously per Obsidian's `PluginSettingTab` contract).
   *
   * On mobile: returns zeros without touching Node fs. The Settings UI
   * section is rendered desktop-side anyway, но this defends against any
   * unexpected mobile invocation.
   *
   * Reads sidecar metas synchronously — fast enough for the small entry
   * counts expected (one tarball per AssetSpace per cached revision).
   * On any other error: returns zeros (display gracefully degrades).
   */
  getCacheStats(): CacheStats {
    // Defensive: some test environments mock `obsidian` without exporting
    // Platform. Treat undefined as desktop (current behaviour pre-mobile
    // guard). Settings UI must not crash on stats render.
    if (isPlatformMobile()) {
      return { count: 0, totalSize: 0, oldestEntry: null };
    }
    if (!existsSync(this.cacheDir)) {
      return { count: 0, totalSize: 0, oldestEntry: null };
    }
    let asUidDirs: string[];
    try {
      asUidDirs = readdirSync(this.cacheDir);
    } catch {
      return { count: 0, totalSize: 0, oldestEntry: null };
    }
    let count = 0;
    let totalSize = 0;
    let oldest: string | null = null;
    for (const name of asUidDirs) {
      const fullDir = path.join(this.cacheDir, name);
      let isDir: boolean;
      try {
        isDir = statSync(fullDir).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;
      let files: string[];
      try {
        files = readdirSync(fullDir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith(".meta.json")) continue;
        try {
          const raw = readFileSync(path.join(fullDir, f), "utf8");
          const parsed = JSON.parse(raw) as CacheEntry;
          if (
            typeof parsed?.cachedAt === "string" &&
            typeof parsed?.sizeBytes === "number"
          ) {
            count += 1;
            totalSize += parsed.sizeBytes;
            if (oldest === null || parsed.cachedAt < oldest) {
              oldest = parsed.cachedAt;
            }
          }
        } catch {
          // Skip malformed sidecar.
        }
      }
    }
    return { count, totalSize, oldestEntry: oldest };
  }

  // ─────────────────────────── internals ──────────────────────────────────

  private getCachePath(asUid: string, sha: string): string {
    return path.join(this.cacheDir, asUid, `${sha}.tar.gz`);
  }

  private getMetaPath(asUid: string, sha: string): string {
    return path.join(this.cacheDir, asUid, `${sha}.meta.json`);
  }

  private assertDesktop(op: string): void {
    if (isPlatformMobile()) {
      throw new Error(
        `SwitchCacheLayer.${op}: mobile not supported (RFC 22b50a17 is desktop-only)`,
      );
    }
  }

  /**
   * Recursively walk `sourceDir`, building the list of TarFileInput entries
   * with content-root convention (paths relative to `sourceDir`). Includes
   * directories so empty subdirs are preserved on restore.
   */
  private async collectTarInputs(sourceDir: string): Promise<TarFileInput[]> {
    const out: TarFileInput[] = [];
    const stack: Array<{ abs: string; rel: string }> = [
      { abs: sourceDir, rel: "" },
    ];
    for (;;) {
      const next = stack.pop();
      if (next === undefined) break;
      const { abs, rel } = next;
      const dirEntries = await fsPromises.readdir(abs, { withFileTypes: true });
      for (const entry of dirEntries) {
        const childAbs = path.join(abs, entry.name);
        const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
          out.push({ name: `${childRel}/`, attrs: { mode: "755" } });
          stack.push({ abs: childAbs, rel: childRel });
        } else if (entry.isFile()) {
          const data = await fsPromises.readFile(childAbs);
          out.push({ name: childRel, data: new Uint8Array(data) });
        }
        // Skip symlinks / special files — same conservative stance as
        // TarExtractor's zip-slip checks rejecting non-regular entries.
      }
    }
    return out;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Defensive `Platform.isMobile` reader — some test environments mock the
 * `obsidian` module without exporting Platform. Treat `undefined` as
 * desktop (the historic behaviour before this guard was added). Real
 * Obsidian (desktop OR mobile) always exports Platform.
 */
function isPlatformMobile(): boolean {
  try {
    return Boolean(Platform?.isMobile);
  } catch {
    return false;
  }
}

/**
 * SwitchCacheLayer — infrastructure scaffold для FocusProfile switch cache
 * (RFC 0a0791c1 §B.5). In v3 backward-compat mode: API surface complete,
 * storage is **in-memory only**. Real filesystem cache I/O deferred to
 * Phase C+D when B.3's pull/restore stubs activate.
 *
 * Why in-memory only (v3):
 * - B.3's `pullAssetSpace` + `restoreFromCache` throw «Phase C+D not implemented»;
 *   nothing populates the cache at runtime.
 * - Settings UI (B.8) wires `getCacheStats()` and shows zeros — acceptable
 *   user-visible behavior since profile switching in v3 only re-indexes RDF
 *   (no filesystem snapshot needed).
 * - Real fs storage location is platform-specific (macOS Library/Caches vs iOS
 *   app data dir) and adaptive-cap requires disk-space probing — both deferred
 *   с Vision Lock #C+D scope split.
 *
 * Activation path (Phase C+D):
 * 1. Replace `Map<string, CacheEntry>` storage with `vault.adapter`/`fs/promises`
 *    filesystem adapter (platform-detected location)
 * 2. Implement `computeAdaptiveCap` to read free disk (statvfs / fs.statfsSync)
 * 3. Wire B.3 `pullAssetSpace` to call `cacheAssetSpace` post-pull
 * 4. Wire B.3 `restoreFromCache` to call `restoreCachedAssetSpace`
 *
 * API surface (frozen в B.5, callers can rely on it):
 * - `cacheAssetSpace(asUid, files)`
 * - `restoreCachedAssetSpace(asUid): Map | null`
 * - `evictOldest(targetSize)` — LRU eviction
 * - `getCacheStats()` — `{count, totalSize, oldestEntry}`
 */

export type FileBlob = Uint8Array;

export interface CacheEntry {
  asUid: string;
  files: Map<string, FileBlob>;
  /** Bytes total (sum of all blobs in this entry). */
  size: number;
  /** Epoch ms when entry was first cached. */
  cachedAt: number;
  /** Epoch ms last touched (read or write) — used by LRU eviction. */
  lastTouched: number;
}

export interface CacheStats {
  /** Number of AssetSpace entries currently cached. */
  count: number;
  /** Aggregate byte size across all entries. */
  totalSize: number;
  /** ISO timestamp of the oldest entry's `cachedAt`, or null if empty. */
  oldestEntry: string | null;
}

export interface SwitchCacheLayerOptions {
  /**
   * Maximum cache size in bytes. Defaults to `50 MB` (50 * 1024 * 1024).
   * In Phase C+D будет computed adaptively as `max(50MB, 5% free disk)`
   * per Architect #9; in v3 this is a fixed cap.
   */
  maxBytes?: number;
  /** Injectable `Date.now` для deterministic tests. */
  now?: () => number;
}

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

export class SwitchCacheLayer {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxBytes: number;
  private readonly now: () => number;

  constructor(options: SwitchCacheLayerOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Cache a snapshot of an AssetSpace's files. Overwrites any existing entry
   * for the same `asUid`. Triggers LRU eviction if total size would exceed cap.
   *
   * @param asUid AssetSpace UID (vault frontmatter `exo__Asset_uid`)
   * @param files Map of `vault-relative-path → file content bytes`
   */
  async cacheAssetSpace(asUid: string, files: Map<string, FileBlob>): Promise<void> {
    const t = this.now();
    const size = SwitchCacheLayer.sumBlobBytes(files);
    const entry: CacheEntry = {
      asUid,
      files: new Map(files),
      size,
      cachedAt: t,
      lastTouched: t,
    };

    // Free space first if the new entry alone would exceed cap.
    if (size > this.maxBytes) {
      // Entry too large to ever fit — refuse silently (per Phase C+D safety: do not throw).
      return;
    }

    this.entries.set(asUid, entry);
    await this.evictOldest(this.maxBytes);
  }

  /**
   * Retrieve a cached AssetSpace snapshot. Returns `null` if not cached.
   * Touches `lastTouched` for LRU bookkeeping.
   */
  async restoreCachedAssetSpace(asUid: string): Promise<Map<string, FileBlob> | null> {
    const entry = this.entries.get(asUid);
    if (!entry) return null;
    entry.lastTouched = this.now();
    // Return a copy to avoid caller mutating cached state.
    return new Map(entry.files);
  }

  /**
   * Evict least-recently-touched entries until aggregate size ≤ `targetSize`.
   * No-op if already under target.
   */
  async evictOldest(targetSize: number): Promise<void> {
    while (this.totalSize() > targetSize && this.entries.size > 0) {
      const oldestUid = this.findOldestUid();
      if (oldestUid === null) break;
      this.entries.delete(oldestUid);
    }
  }

  /** Synchronous stats snapshot — wired into Settings UI display (B.8). */
  getCacheStats(): CacheStats {
    if (this.entries.size === 0) {
      return { count: 0, totalSize: 0, oldestEntry: null };
    }
    let oldest = Infinity;
    let totalSize = 0;
    for (const entry of this.entries.values()) {
      totalSize += entry.size;
      if (entry.cachedAt < oldest) oldest = entry.cachedAt;
    }
    return {
      count: this.entries.size,
      totalSize,
      oldestEntry: new Date(oldest).toISOString(),
    };
  }

  // === Helpers ===

  private totalSize(): number {
    let sum = 0;
    for (const entry of this.entries.values()) sum += entry.size;
    return sum;
  }

  private findOldestUid(): string | null {
    let oldestUid: string | null = null;
    let oldestTouched = Infinity;
    for (const [uid, entry] of this.entries) {
      if (entry.lastTouched < oldestTouched) {
        oldestTouched = entry.lastTouched;
        oldestUid = uid;
      }
    }
    return oldestUid;
  }

  private static sumBlobBytes(files: Map<string, FileBlob>): number {
    let sum = 0;
    for (const blob of files.values()) sum += blob.byteLength;
    return sum;
  }
}

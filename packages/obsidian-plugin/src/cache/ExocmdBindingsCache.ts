import type { ResolvedCommand } from "exocortex";
import type { ILogger } from "exocortex";

/**
 * On-disk schema version. Bump only on incompatible structural changes;
 * version mismatch causes the reader to discard the file and the indexer
 * to rebuild from scratch.
 */
export const EXOCMD_BINDINGS_CACHE_VERSION = 1;

/**
 * Cached visible-command list for a single class signature plus a hash of
 * the underlying precondition definitions so the indexer can detect when
 * an exocmd-asset edit invalidates the cached commands.
 *
 * `commands` is the JSON-serialized `ResolvedCommand[]` exactly as the
 * full-path resolver would have produced — the consumer feeds it back to
 * the same button-building pipeline, so cache-rendered DOM is structurally
 * identical to full-path-rendered DOM (Issue #3183 AC #3: zero unmount
 * events when full-path output matches cache output).
 */
export interface ExocmdBindingsCacheEntry {
  readonly commands: ReadonlyArray<ResolvedCommand>;
  readonly preconditions_signature: string;
}

/**
 * On-disk cache file contract (Issue #3183).
 *
 * `bindings` is keyed by a normalized class signature — typically the
 * primary `exo__Instance_class` reference of an asset (UUID-canonical
 * after the 2026-05-16 migration). The indexer derives this key the same
 * way the reader does so lookups are stable across both.
 */
export interface ExocmdBindingsCacheFile {
  readonly version: number;
  readonly plugin_version: string;
  readonly last_full_scan_at: string;
  readonly bindings: Record<string, ExocmdBindingsCacheEntry>;
}

/**
 * Vault-side I/O contract — narrow on purpose so this module is easy to
 * fake in unit tests (the prod implementation is `ObsidianFileSystemAdapter`
 * but unit tests inject an in-memory map). Paths are vault-relative.
 */
export interface CacheFileSystem {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

/**
 * Default vault-relative cache file path. Hidden-prefix `.exocortex/`
 * keeps it out of the user-visible file tree while staying under the
 * vault root so it travels with the user's notes (and iCloud-syncs
 * predictably — RFC body §Edge cases — discard on conflict).
 */
export const DEFAULT_CACHE_FILE_PATH =
  ".exocortex/cache/exocmd-bindings.json";

/**
 * Persistent disk cache for resolved exocmd bindings (Issue #3183).
 *
 * # Purpose
 *
 * The cold-start fast-path resolver (#3171, `ExocmdFastResolver`) gives
 * the user a partial button set in ~5 s because it builds a mini in-memory
 * triple store that lacks the class-hierarchy graph CREATE-category
 * preconditions need. The remaining ~16 s gap until the full path
 * completes leaves CREATE buttons hidden and triggers a DOM unmount/remount
 * flicker (#3177) when they eventually appear.
 *
 * This cache short-circuits that gap on every cold start after the first
 * by reading a pre-computed `class → ResolvedCommand[]` map from disk
 * (~10 ms) and feeding it straight to the button builder before the
 * background `convertVault()` even starts. On the very first cold start
 * (or after invalidation) the cache miss falls through to the fast-path
 * resolver, then the background indexer populates the file for next time.
 *
 * # Contract
 *
 * - **Versioned**: `version` + `plugin_version` are checked on read;
 *   either mismatch discards the file (fall-through to fast-path,
 *   indexer rebuilds).
 * - **Corruption-tolerant**: any JSON parse error, missing field, or
 *   unreadable file is treated as "no cache" — never throws to the caller.
 * - **Atomic writes**: writer goes through a tmp-path + rename so a crash
 *   mid-write leaves either the previous valid file or no file (caller
 *   will rebuild) — never a half-written JSON the next read would discard.
 * - **Read-only methods**: lookups are synchronous against the in-memory
 *   snapshot loaded by `load()`; the file is touched only by `load()` and
 *   `save()`.
 *
 * The class is decoupled from Obsidian; the I/O surface is `CacheFileSystem`
 * which is satisfied by both `ObsidianFileSystemAdapter` (prod) and a
 * trivial in-memory map (tests).
 */
export class ExocmdBindingsCache {
  private snapshot: ExocmdBindingsCacheFile | null = null;

  constructor(
    private readonly fs: CacheFileSystem,
    private readonly cacheFilePath: string,
    private readonly currentPluginVersion: string,
    private readonly logger: ILogger,
  ) {}

  /**
   * Read the cache file from disk and validate it against the current
   * plugin version + schema version. Returns the parsed snapshot when
   * valid, `null` when missing/invalid/incompatible (which the caller
   * MUST treat as a cache miss — never as an error).
   *
   * Idempotent: subsequent calls re-read from disk so the indexer's
   * post-scan `save()` becomes visible without restarting the plugin.
   */
  async load(): Promise<ExocmdBindingsCacheFile | null> {
    let raw: string;
    try {
      const exists = await this.fs.exists(this.cacheFilePath);
      if (!exists) {
        this.snapshot = null;
        return null;
      }
      raw = await this.fs.read(this.cacheFilePath);
    } catch (err) {
      this.logger.warn(
        `[ExocmdBindingsCache] failed to read ${this.cacheFilePath}: ${String(err)}`,
      );
      // Issue #3190 — `logger.warn` may be silenced by log-channel settings;
      // surface every cache-pipeline failure to DevTools console as well so
      // future regressions are visible without re-enabling Verbose logging.
      console.error("[exocortex] cache read failed:", err);
      this.snapshot = null;
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.logger.warn(
        `[ExocmdBindingsCache] cache file is not valid JSON, discarding: ${String(err)}`,
      );
      console.error("[exocortex] cache parse failed:", err);
      this.snapshot = null;
      return null;
    }

    if (!this.isValidFileShape(parsed)) {
      this.logger.warn(
        `[ExocmdBindingsCache] cache file has unexpected shape, discarding`,
      );
      console.error(
        "[exocortex] cache shape-validation failed:",
        "cache file has unexpected shape",
      );
      this.snapshot = null;
      return null;
    }

    if (parsed.version !== EXOCMD_BINDINGS_CACHE_VERSION) {
      this.logger.info(
        `[ExocmdBindingsCache] cache schema version mismatch (file=${parsed.version}, expected=${EXOCMD_BINDINGS_CACHE_VERSION}); discarding`,
      );
      this.snapshot = null;
      return null;
    }

    if (parsed.plugin_version !== this.currentPluginVersion) {
      this.logger.info(
        `[ExocmdBindingsCache] plugin_version mismatch (file=${parsed.plugin_version}, current=${this.currentPluginVersion}); discarding`,
      );
      this.snapshot = null;
      return null;
    }

    this.snapshot = parsed;
    return parsed;
  }

  /**
   * Look up the cached commands for a given class signature against the
   * currently-loaded snapshot. Returns `null` on miss so callers can fall
   * through cleanly. Does NOT touch disk — `load()` must run first.
   */
  lookup(classKey: string): ExocmdBindingsCacheEntry | null {
    if (this.snapshot === null) return null;
    const entry = this.snapshot.bindings[classKey];
    return entry ?? null;
  }

  /**
   * The class keys present in the currently-loaded snapshot. Useful for
   * indexer diff / pruning logic. Empty array when no snapshot loaded.
   */
  knownClassKeys(): string[] {
    if (this.snapshot === null) return [];
    return Object.keys(this.snapshot.bindings);
  }

  /**
   * Write a fresh snapshot to disk atomically. The previous file (if any)
   * is replaced only after the new content is fully written to a tmp path,
   * so a crash mid-write leaves either the previous valid file or none
   * at all — never a half-written JSON.
   *
   * Updates the in-memory snapshot on success so subsequent `lookup()`
   * calls see the new data without re-reading the disk.
   */
  async save(
    bindings: Record<string, ExocmdBindingsCacheEntry>,
  ): Promise<void> {
    const payload: ExocmdBindingsCacheFile = {
      version: EXOCMD_BINDINGS_CACHE_VERSION,
      plugin_version: this.currentPluginVersion,
      last_full_scan_at: new Date().toISOString(),
      bindings,
    };
    const serialized = JSON.stringify(payload, null, 2);
    const tmpPath = `${this.cacheFilePath}.tmp`;

    try {
      await this.ensureParentDir(this.cacheFilePath);
    } catch (err) {
      this.logger.warn(
        `[ExocmdBindingsCache] failed to ensure parent dir: ${String(err)}`,
      );
      console.error("[exocortex] cache mkdir failed:", err);
      // Try the write anyway — adapter may auto-create.
    }

    try {
      // Adapter `write` overwrites; that's fine for the tmp slot.
      await this.fs.write(tmpPath, serialized);
    } catch (err) {
      this.logger.warn(
        `[ExocmdBindingsCache] failed to write tmp cache file: ${String(err)}`,
      );
      console.error("[exocortex] cache write-tmp failed:", err);
      throw err;
    }

    try {
      // Some adapters (Obsidian's `vault.adapter`) require the target to
      // not exist before rename. Remove it best-effort first.
      const targetExists = await this.fs.exists(this.cacheFilePath);
      if (targetExists) {
        await this.fs.remove(this.cacheFilePath);
      }
      await this.fs.rename(tmpPath, this.cacheFilePath);
    } catch (err) {
      this.logger.warn(
        `[ExocmdBindingsCache] failed to rename tmp file into place: ${String(err)}`,
      );
      console.error("[exocortex] cache rename failed:", err);
      // Best-effort cleanup of orphaned tmp.
      try {
        if (await this.fs.exists(tmpPath)) {
          await this.fs.remove(tmpPath);
        }
      } catch {
        /* swallow */
      }
      throw err;
    }

    this.snapshot = payload;
  }

  /**
   * Forget the in-memory snapshot. Used by tests and by future invalidation
   * hooks that need to force a reload on next `load()`.
   */
  clear(): void {
    this.snapshot = null;
  }

  /**
   * Best-effort recursive `mkdir` for the cache file's parent directory.
   * The Obsidian adapter's `mkdir` does NOT auto-create intermediate dirs
   * on every platform, so we walk the path manually. `Promise.allSettled`
   * would be overkill — failures are swallowed since `save()` will surface
   * the real error on `write`.
   */
  private async ensureParentDir(filePath: string): Promise<void> {
    const parts = filePath.split("/");
    parts.pop(); // drop file name
    if (parts.length === 0) return;
    let current = "";
    for (const part of parts) {
      current = current.length === 0 ? part : `${current}/${part}`;
      if (current.length === 0) continue;
      try {
        const exists = await this.fs.exists(current);
        if (!exists) {
          await this.fs.mkdir(current);
        }
      } catch {
        // Swallow: deeper write will fail with a descriptive error.
      }
    }
  }

  private isValidFileShape(
    candidate: unknown,
  ): candidate is ExocmdBindingsCacheFile {
    if (typeof candidate !== "object" || candidate === null) return false;
    const c = candidate as Record<string, unknown>;
    if (typeof c.version !== "number") return false;
    if (typeof c.plugin_version !== "string") return false;
    if (typeof c.last_full_scan_at !== "string") return false;
    if (typeof c.bindings !== "object" || c.bindings === null) return false;
    for (const value of Object.values(c.bindings as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) return false;
      const entry = value as Record<string, unknown>;
      if (!Array.isArray(entry.commands)) return false;
      if (typeof entry.preconditions_signature !== "string") return false;
    }
    return true;
  }
}

/**
 * Convenience helper for computing a stable hash of an array of precondition
 * SPARQL/host-function/query identifiers. Used by the indexer to detect
 * "preconditions for this class changed" without recomputing the whole
 * resolved command list.
 *
 * Implementation is deliberately a simple FNV-1a 32-bit hash so it works
 * in browser + node + jsdom test envs without requiring `crypto.subtle`.
 * Collisions are tolerable here: a collision only causes a missed
 * invalidation that the next plugin reload corrects.
 */
export function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

import path from "path";
import crypto from "crypto";
import fs from "fs-extra";
import { Triple } from "exocortex";
import {
  serializeNode,
  deserializeNode,
  type SerializedTriple,
} from "./tripleSerialization.js";
import type { LoadOrBuildResult } from "./CacheManager.js";

/**
 * Combined-cache metadata stored alongside the multi-vault triple cache.
 *
 * Unlike single-vault CacheManager metadata, this tracks mtimes for ALL
 * participating vaults so the cache invalidates whenever ANY vault changes.
 */
export interface CombinedCacheMetadata {
  /** CLI version used to create cache */
  version: string;
  /** Cache creation timestamp (Unix ms) */
  timestamp: number;
  /**
   * All vault paths participating in the combined cache, sorted lexically.
   * Order is normalized — `--also A --also B` and `--also B --also A` produce
   * the same metadata.vaultPaths array and the same cache file name.
   */
  vaultPaths: string[];
  /** Map of vaultPath → mtimeMs at cache creation time */
  vaultMtimes: Record<string, number>;
  /** Number of triples cached (after RDFS + prototype materialization) */
  tripleCount: number;
}

interface CombinedCacheData {
  metadata: CombinedCacheMetadata;
  triples: SerializedTriple[];
}

export interface CombinedCacheStats {
  /** Triple count in cache */
  tripleCount: number;
  /** Cache creation timestamp */
  createdAt: Date;
  /** Whether cache is currently valid (all vault mtimes match) */
  isValid: boolean;
  /** Cache file size in bytes */
  sizeBytes: number;
  /** All vault paths represented in the cache */
  vaultPaths: string[];
}

/**
 * Manages a persistent triple cache that spans multiple vaults.
 *
 * Issue #3281: cross-vault SPARQL recall was ~19% because (a) `sparql index`
 * had no `--also` flag and (b) `query --use-cache --also` could only load
 * per-vault caches that materialize inferences within each vault individually,
 * missing cross-vault RDFS subClass chains and prototype inheritance.
 *
 * CombinedCacheManager fixes this by:
 *   - Concatenating triples from primary + each `--also` vault
 *   - Allowing the caller (sparql-index command) to run RDFS / prototype-chain
 *     materialization on the **combined** triple store before saving
 *   - Persisting the materialized result to a per-combination cache file so
 *     subsequent `query --use-cache --also` reads see the full inference set
 *
 * Cache file path: `<primary>/.exocortex/cache/combined-<hash>.json`
 *   where `<hash>` is a stable hash of the sorted list of all vault paths.
 *   Two runs that pass the same vaults in different `--also` orders share
 *   the same physical cache file.
 *
 * Invalidation: cache is invalid when ANY participating vault's mtimeMs no
 * longer matches the recorded value.
 *
 * @example
 * ```typescript
 * const cache = new CombinedCacheManager("/path/to/primary", ["/path/to/other"]);
 *
 * // Check / build
 * if (!await cache.isCacheValid()) {
 *   const triples = await loadAllVaultTriples(); // caller orchestrates
 *   // ... caller runs RDFS + prototype-chain materialization ...
 *   await cache.saveTriples(materializedTriples);
 * }
 *
 * // Load
 * const triples = await cache.loadFromCache();
 * ```
 */
export class CombinedCacheManager {
  private readonly primaryVaultPath: string;
  /** Sorted, deduplicated `--also` vault paths (does NOT include primary). */
  private readonly alsoVaultPaths: string[];
  /** Primary + sorted alsos, used for cache-key hash and mtime tracking. */
  private readonly allVaultPaths: string[];
  private readonly cachePath: string;
  /**
   * Schema version of the materialized triple set stored in the combined
   * cache. Bumped whenever the triple-emission semantics change in a way
   * that makes pre-bump cached triples inconsistent with the current
   * emitter — `isCacheValid` rejects caches with a different schema so
   * users do not silently consume stale triples after a CLI upgrade.
   *
   * Issue #3219 bump (`1.0.0` → `1.1.0`): subject IRIs for `--also`
   * vaults rooted at `assetspaces/<sub>` now carry the `assetspaces/<sub>/`
   * prefix instead of being stripped to the bare basename. Pre-fix caches
   * contain the stripped form and would silently return wrong results for
   * class-filtered SPARQL queries.
   */
  private readonly cliVersion: string = "1.1.0";

  constructor(primaryVaultPath: string, alsoVaultPaths: string[] = []) {
    this.primaryVaultPath = path.resolve(primaryVaultPath);

    // Resolve, dedupe, and sort `--also` paths. Sorting normalizes ordering so
    // `--also A --also B` and `--also B --also A` share the same cache file.
    // Dedupe protects against accidental repetition of the primary path or
    // duplicate `--also` flags.
    const resolved = alsoVaultPaths
      .map((p) => path.resolve(p))
      .filter((p) => p !== this.primaryVaultPath);
    const uniq = Array.from(new Set(resolved)).sort();
    this.alsoVaultPaths = uniq;

    // Full sorted list including primary, used for cache key + mtime tracking.
    this.allVaultPaths = [this.primaryVaultPath, ...uniq].sort();

    const hash = CombinedCacheManager.computeCacheKey(this.allVaultPaths);
    this.cachePath = path.join(
      this.primaryVaultPath,
      ".exocortex",
      "cache",
      `combined-${hash}.json`,
    );
  }

  /**
   * Returns the path to the combined cache file. Always lives under
   * `<primary>/.exocortex/cache/`.
   */
  getCachePath(): string {
    return this.cachePath;
  }

  /** Returns the resolved primary vault path. */
  getPrimaryVaultPath(): string {
    return this.primaryVaultPath;
  }

  /**
   * Returns the resolved `--also` vault paths, sorted and deduplicated.
   * Does NOT include the primary vault.
   */
  getAlsoVaultPaths(): string[] {
    return [...this.alsoVaultPaths];
  }

  /**
   * Returns all vault paths (primary + alsos), sorted. Used for hash
   * computation and mtime checks.
   */
  getAllVaultPaths(): string[] {
    return [...this.allVaultPaths];
  }

  /**
   * Computes a stable cache-key hash from a sorted list of vault paths.
   *
   * 64-bit hex digest is enough to make accidental collisions astronomically
   * unlikely across realistic combinations of vault paths a user might run.
   */
  static computeCacheKey(sortedVaultPaths: string[]): string {
    return crypto
      .createHash("sha256")
      .update(sortedVaultPaths.join("\n"))
      .digest("hex")
      .slice(0, 16);
  }

  /**
   * Cache is valid when:
   *   - Cache file exists and parses
   *   - Metadata version present
   *   - Recorded vaultPaths set matches current allVaultPaths (deep equal)
   *   - mtimeMs of every recorded vault still matches
   */
  async isCacheValid(): Promise<boolean> {
    try {
      if (!(await fs.pathExists(this.cachePath))) {
        return false;
      }

      const cacheData = (await fs.readJson(this.cachePath)) as CombinedCacheData;

      if (
        !cacheData.metadata ||
        typeof cacheData.metadata.tripleCount !== "number" ||
        !Array.isArray(cacheData.metadata.vaultPaths) ||
        !cacheData.metadata.vaultMtimes ||
        typeof cacheData.metadata.vaultMtimes !== "object"
      ) {
        return false;
      }

      // Issue #3219 — reject caches built with a different triple-emission
      // schema version. Pre-bump caches for `--also` flag have stripped
      // subject IRIs (no `assetspaces/<sub>/` prefix); silently feeding them
      // into the new query path would mask the fix and return wrong results
      // for class-filtered cross-vault SPARQL queries.
      if (cacheData.metadata.version !== this.cliVersion) {
        return false;
      }

      // Path set must match exactly (same vaults participated)
      const recordedSorted = [...cacheData.metadata.vaultPaths].sort();
      if (
        recordedSorted.length !== this.allVaultPaths.length ||
        recordedSorted.some((p, i) => p !== this.allVaultPaths[i])
      ) {
        return false;
      }

      // Every vault's current mtime must match the recorded value
      for (const vp of this.allVaultPaths) {
        const recordedMtime = cacheData.metadata.vaultMtimes[vp];
        if (typeof recordedMtime !== "number") {
          return false;
        }
        try {
          const stats = await fs.stat(vp);
          if (stats.mtimeMs !== recordedMtime) {
            return false;
          }
        } catch {
          // Vault disappeared since cache was built
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Loads triples from the cache file. Caller MUST ensure cache is valid first
   * (via `isCacheValid()`); calling this on a stale cache returns stale data.
   */
  async loadFromCache(): Promise<Triple[]> {
    const cacheData = (await fs.readJson(this.cachePath)) as CombinedCacheData;
    return cacheData.triples.map((data) => {
      return new Triple(
        deserializeNode(data.subject) as Triple["subject"],
        deserializeNode(data.predicate) as Triple["predicate"],
        deserializeNode(data.object) as Triple["object"],
      );
    });
  }

  /**
   * Convenience: load triples from cache if valid, otherwise return null.
   *
   * Unlike single-vault CacheManager.loadOrBuild, this does NOT auto-build
   * the cache — building requires orchestration (multi-vault loading,
   * cross-vault wikilink resolution, RDFS + prototype materialization) that
   * is owned by the `sparql-index` command. Callers that get null should
   * either build via `sparql-index --also` first, or fall back to a per-vault
   * non-cached path.
   */
  async loadIfValid(): Promise<LoadOrBuildResult | null> {
    const startTime = Date.now();
    if (!(await this.isCacheValid())) {
      return null;
    }
    const triples = await this.loadFromCache();
    return {
      triples,
      cacheHit: true,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Saves a set of materialized triples to the combined cache.
   *
   * Captures the mtime of every participating vault so subsequent
   * `isCacheValid()` calls can detect any vault change.
   *
   * Implementation note: the cache directory is created BEFORE capturing
   * vault mtimes, because creating `.exocortex/cache/` under the primary
   * vault mutates the primary vault's directory mtime. Capturing mtimes
   * after the ensureDir guarantees the recorded value matches the
   * post-write filesystem state, so a fresh `isCacheValid()` immediately
   * after `saveTriples()` returns true.
   */
  async saveTriples(triples: Triple[]): Promise<void> {
    // Create cache dir first so it doesn't bump primary's mtime after
    // we've already recorded the "before" value.
    await fs.ensureDir(path.dirname(this.cachePath));

    const serializedTriples = triples.map((triple) => ({
      subject: serializeNode(triple.subject),
      predicate: serializeNode(triple.predicate),
      object: serializeNode(triple.object),
    }));

    // Capture mtimes after ensureDir so the values reflect post-write state.
    const vaultMtimes: Record<string, number> = {};
    for (const vp of this.allVaultPaths) {
      const stats = await fs.stat(vp);
      vaultMtimes[vp] = stats.mtimeMs;
    }

    const cacheData: CombinedCacheData = {
      metadata: {
        version: this.cliVersion,
        timestamp: Date.now(),
        vaultPaths: [...this.allVaultPaths],
        vaultMtimes,
        tripleCount: triples.length,
      },
      triples: serializedTriples,
    };

    await fs.writeJson(this.cachePath, cacheData, { spaces: 0 });
  }

  /** Deletes the combined cache file if it exists. */
  async invalidate(): Promise<void> {
    if (await fs.pathExists(this.cachePath)) {
      await fs.remove(this.cachePath);
    }
  }

  /**
   * Returns statistics about the current combined cache, or null if the cache
   * file does not exist.
   */
  async getCacheStats(): Promise<CombinedCacheStats | null> {
    try {
      if (!(await fs.pathExists(this.cachePath))) {
        return null;
      }

      const cacheData = (await fs.readJson(this.cachePath)) as CombinedCacheData;
      const fileStats = await fs.stat(this.cachePath);
      const isValid = await this.isCacheValid();

      return {
        tripleCount: cacheData.metadata.tripleCount,
        createdAt: new Date(cacheData.metadata.timestamp),
        isValid,
        sizeBytes: fileStats.size,
        vaultPaths: cacheData.metadata.vaultPaths,
      };
    } catch {
      return null;
    }
  }
}

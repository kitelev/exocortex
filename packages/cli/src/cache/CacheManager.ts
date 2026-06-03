import path from "path";
import fs from "fs-extra";
import { NoteToRDFConverter, Triple, IRI } from "exocortex";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import {
  serializeNode,
  deserializeNode,
  type SerializedNode,
  type SerializedTriple,
} from "./tripleSerialization.js";

// Re-export for callers that previously imported these from CacheManager
// (kept for backward compatibility within the cli package surface).
export { serializeNode, deserializeNode };
export type { SerializedNode, SerializedTriple };

/**
 * Cache metadata stored alongside the triple cache
 */
export interface CacheMetadata {
  /** CLI version used to create cache */
  version: string;
  /** Cache creation timestamp (Unix ms) */
  timestamp: number;
  /** Absolute path to vault */
  vaultPath: string;
  /** Number of triples cached */
  tripleCount: number;
  /** Vault directory mtime when cache was created */
  vaultMtime: number;
}

/**
 * Cache file structure
 */
interface CacheData {
  metadata: CacheMetadata;
  triples: SerializedTriple[];
}

/**
 * Statistics about the current cache
 */
export interface CacheStats {
  /** Number of triples in cache */
  tripleCount: number;
  /** Cache creation timestamp */
  createdAt: Date;
  /** Whether cache is currently valid */
  isValid: boolean;
  /** Cache file size in bytes */
  sizeBytes: number;
}

/**
 * Result of loadOrBuild operation
 */
export interface LoadOrBuildResult {
  /** The loaded or built triples */
  triples: Triple[];
  /** Whether the triples came from cache (true) or were freshly built (false) */
  cacheHit: boolean;
  /** Time taken to load/build in milliseconds */
  durationMs: number;
}

/**
 * Result of buildCache operation
 */
export interface BuildCacheResult {
  /** Number of triples cached */
  tripleCount: number;
  /** Time taken to build cache in milliseconds */
  durationMs: number;
}

/**
 * Information about a file that was skipped during indexing
 */
export interface SkippedFileInfo {
  /** Path of the skipped file */
  path: string;
  /** Reason why the file was skipped */
  reason: string;
}

/**
 * Result of buildCacheWithValidation operation
 */
export interface BuildCacheWithValidationResult extends BuildCacheResult {
  /** Files that were skipped during indexing */
  skippedFiles: SkippedFileInfo[];
  /** Summary statistics */
  summary: {
    /** Total number of files in vault */
    total: number;
    /** Number of files successfully indexed */
    indexed: number;
    /** Number of files skipped */
    skipped: number;
  };
}

/**
 * Options for building cache with validation
 */
export interface BuildCacheOptions {
  /** If true, throws on first invalid IRI instead of skipping */
  strict?: boolean;
}

/**
 * Manages persistent triple cache for SPARQL queries.
 *
 * The cache stores RDF triples converted from vault notes, eliminating
 * the need to re-parse the entire vault on each query. Cache is invalidated
 * when the vault directory's modification time changes.
 *
 * @example
 * ```typescript
 * const cache = new CacheManager("/path/to/vault");
 *
 * // Load from cache or build fresh
 * const { triples, cacheHit } = await cache.loadOrBuild();
 * console.log(`Loaded ${triples.length} triples (cache ${cacheHit ? 'hit' : 'miss'})`);
 *
 * // Check cache stats
 * const stats = await cache.getCacheStats();
 * if (stats) {
 *   console.log(`Cache has ${stats.tripleCount} triples, valid: ${stats.isValid}`);
 * }
 *
 * // Force rebuild
 * await cache.invalidate();
 * await cache.buildCache();
 * ```
 */
export class CacheManager {
  private readonly vaultPath: string;
  private readonly cachePath: string;
  private readonly cliVersion: string = "1.0.0"; // Will be replaced by actual version

  constructor(vaultPath: string) {
    this.vaultPath = path.resolve(vaultPath);
    this.cachePath = path.join(this.vaultPath, ".exocortex", "cache", "triples.json");
  }

  /**
   * Returns the path to the cache file
   */
  getCachePath(): string {
    return this.cachePath;
  }

  /**
   * Checks if the cache is valid.
   *
   * Cache is valid when:
   * - Cache file exists
   * - Cache metadata is complete
   * - Vault mtime matches cached mtime (no modifications since cache creation)
   */
  async isCacheValid(): Promise<boolean> {
    try {
      if (!await fs.pathExists(this.cachePath)) {
        return false;
      }

      const cacheData = await fs.readJson(this.cachePath) as CacheData;

      // Validate metadata structure
      if (!cacheData.metadata ||
          typeof cacheData.metadata.vaultMtime !== "number" ||
          typeof cacheData.metadata.tripleCount !== "number") {
        return false;
      }

      // Check vault mtime
      const vaultStats = await fs.stat(this.vaultPath);
      if (vaultStats.mtimeMs !== cacheData.metadata.vaultMtime) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Loads triples from cache if valid, otherwise builds and caches them.
   *
   * @returns LoadOrBuildResult with triples, cache hit status, and duration
   */
  async loadOrBuild(): Promise<LoadOrBuildResult> {
    const startTime = Date.now();

    if (await this.isCacheValid()) {
      const triples = await this.loadFromCache();
      return {
        triples,
        cacheHit: true,
        durationMs: Date.now() - startTime,
      };
    }

    const { tripleCount } = await this.buildCache();
    const triples = await this.loadFromCache();

    return {
      triples,
      cacheHit: false,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Loads triples from the cache file.
   * Assumes cache is valid - call isCacheValid() first.
   */
  private async loadFromCache(): Promise<Triple[]> {
    const cacheData = await fs.readJson(this.cachePath) as CacheData;
    return cacheData.triples.map(this.deserializeTriple);
  }

  /**
   * Builds and persists the triple cache.
   *
   * Converts all vault notes to RDF triples and saves them to the cache file.
   */
  async buildCache(): Promise<BuildCacheResult> {
    const result = await this.buildCacheWithValidation({ strict: false });
    return {
      tripleCount: result.tripleCount,
      durationMs: result.durationMs,
    };
  }

  /**
   * Builds and persists the triple cache with validation.
   *
   * Issue #2205: Enhanced version that provides detailed information about
   * files that were skipped during indexing.
   *
   * @param options - Build options
   * @param options.strict - If true, throws on first invalid IRI instead of skipping
   * @returns Result with triples, skipped files, and summary statistics
   *
   * @throws Error if strict mode is enabled and an invalid IRI is encountered
   */
  async buildCacheWithValidation(
    options: BuildCacheOptions = {}
  ): Promise<BuildCacheWithValidationResult> {
    const startTime = Date.now();

    // Convert vault to triples with validation
    const vaultAdapter = new FileSystemVaultAdapter(this.vaultPath);
    const converter = new NoteToRDFConverter(vaultAdapter);
    const validationResult = await converter.convertVaultWithValidation({
      strict: options.strict ?? false,
    });

    // Get vault mtime for cache validation
    const vaultStats = await fs.stat(this.vaultPath);

    // Serialize triples
    const serializedTriples = validationResult.triples.map(this.serializeTriple);

    // Build cache data
    const cacheData: CacheData = {
      metadata: {
        version: this.cliVersion,
        timestamp: Date.now(),
        vaultPath: this.vaultPath,
        tripleCount: validationResult.triples.length,
        vaultMtime: vaultStats.mtimeMs,
      },
      triples: serializedTriples,
    };

    // Ensure cache directory exists
    await fs.ensureDir(path.dirname(this.cachePath));

    // Write cache
    await fs.writeJson(this.cachePath, cacheData, { spaces: 0 });

    return {
      tripleCount: validationResult.triples.length,
      durationMs: Date.now() - startTime,
      skippedFiles: validationResult.skippedFiles,
      summary: validationResult.summary,
    };
  }

  /**
   * Validates vault files for IRI issues without building cache.
   *
   * Issue #2205: Check vault health by identifying files that would
   * cause IRI validation errors during indexing.
   *
   * @returns Array of files with IRI issues and their reasons
   */
  async validateVault(): Promise<SkippedFileInfo[]> {
    const vaultAdapter = new FileSystemVaultAdapter(this.vaultPath);
    const converter = new NoteToRDFConverter(vaultAdapter);
    return converter.validateVault();
  }

  /**
   * Invalidates the cache by deleting the cache file.
   */
  async invalidate(): Promise<void> {
    if (await fs.pathExists(this.cachePath)) {
      await fs.remove(this.cachePath);
    }
  }

  /**
   * Returns statistics about the current cache.
   *
   * @returns CacheStats if cache exists, null otherwise
   */
  async getCacheStats(): Promise<CacheStats | null> {
    try {
      if (!await fs.pathExists(this.cachePath)) {
        return null;
      }

      const cacheData = await fs.readJson(this.cachePath) as CacheData;
      const fileStats = await fs.stat(this.cachePath);
      const isValid = await this.isCacheValid();

      return {
        tripleCount: cacheData.metadata.tripleCount,
        createdAt: new Date(cacheData.metadata.timestamp),
        isValid,
        sizeBytes: fileStats.size,
      };
    } catch {
      return null;
    }
  }

  /**
   * Save an array of triples to cache, replacing existing cache content.
   * Used after materialization to persist inferred triples alongside explicit ones.
   */
  async saveTriples(triples: Triple[]): Promise<void> {
    const vaultStats = await fs.stat(this.vaultPath);
    const serializedTriples = triples.map(this.serializeTriple);

    const cacheData: CacheData = {
      metadata: {
        version: this.cliVersion,
        timestamp: Date.now(),
        vaultPath: this.vaultPath,
        tripleCount: triples.length,
        vaultMtime: vaultStats.mtimeMs,
      },
      triples: serializedTriples,
    };

    await fs.ensureDir(path.dirname(this.cachePath));
    await fs.writeJson(this.cachePath, cacheData, { spaces: 0 });
  }

  /**
   * Serializes a Triple to JSON-compatible format
   */
  private serializeTriple(triple: Triple): SerializedTriple {
    return {
      subject: serializeNode(triple.subject),
      predicate: serializeNode(triple.predicate),
      object: serializeNode(triple.object),
    };
  }

  /**
   * Deserializes a Triple from JSON format
   */
  private deserializeTriple(data: SerializedTriple): Triple {
    return new Triple(
      deserializeNode(data.subject) as Triple["subject"],
      deserializeNode(data.predicate) as IRI,
      deserializeNode(data.object) as Triple["object"],
    );
  }
}

// serializeNode/deserializeNode now live in ./tripleSerialization.ts —
// re-exported above for backward compatibility with imports that
// previously pulled them from this module.

import path from "path";
import fs from "fs-extra";
import { NoteToRDFConverter, Triple, IRI, Literal, BlankNode } from "exocortex";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";

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
 * Serializable triple representation for JSON storage
 */
interface SerializedTriple {
  subject: SerializedNode;
  predicate: SerializedNode;
  object: SerializedNode;
}

/**
 * Serializable RDF node representation
 */
interface SerializedNode {
  type: "IRI" | "Literal" | "BlankNode";
  value: string;
  datatype?: string;
  language?: string;
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
    const startTime = Date.now();

    // Convert vault to triples
    const vaultAdapter = new FileSystemVaultAdapter(this.vaultPath);
    const converter = new NoteToRDFConverter(vaultAdapter);
    const triples = await converter.convertVault();

    // Get vault mtime for cache validation
    const vaultStats = await fs.stat(this.vaultPath);

    // Serialize triples
    const serializedTriples = triples.map(this.serializeTriple);

    // Build cache data
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

    // Ensure cache directory exists
    await fs.ensureDir(path.dirname(this.cachePath));

    // Write cache
    await fs.writeJson(this.cachePath, cacheData, { spaces: 0 });

    return {
      tripleCount: triples.length,
      durationMs: Date.now() - startTime,
    };
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

/**
 * Serializes an RDF node to JSON-compatible format
 */
function serializeNode(node: Triple["subject"] | Triple["predicate"] | Triple["object"]): SerializedNode {
  if (node instanceof IRI) {
    return { type: "IRI", value: node.value };
  }

  if (node instanceof Literal) {
    const result: SerializedNode = { type: "Literal", value: node.value };
    if (node.datatype) {
      result.datatype = node.datatype.value;
    }
    if (node.language) {
      result.language = node.language;
    }
    return result;
  }

  if (node instanceof BlankNode) {
    return { type: "BlankNode", value: node.value };
  }

  // Fallback for QuotedTriple or unknown types
  return { type: "IRI", value: String(node) };
}

/**
 * Deserializes an RDF node from JSON format
 */
function deserializeNode(data: SerializedNode): IRI | Literal | BlankNode {
  switch (data.type) {
    case "IRI":
      return new IRI(data.value);
    case "Literal":
      if (data.datatype) {
        return new Literal(data.value, new IRI(data.datatype));
      }
      if (data.language) {
        return new Literal(data.value, undefined, data.language);
      }
      return new Literal(data.value);
    case "BlankNode":
      return new BlankNode(data.value);
    default:
      return new IRI(data.value);
  }
}

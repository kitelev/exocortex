import { injectable } from "tsyringe";
import { LoggingService } from "./LoggingService";

/**
 * A vector entry stored in the vector store
 */
export interface VectorEntry {
  /** Unique identifier (typically file path) */
  id: string;
  /** The embedding vector */
  vector: number[];
  /** Optional metadata */
  metadata?: Record<string, unknown>;
  /** Timestamp when the vector was created/updated */
  timestamp: number;
  /** Hash of the content used to detect changes */
  contentHash?: string;
}

/**
 * Result of a similarity search
 */
export interface SimilarityResult {
  /** The matched entry */
  entry: VectorEntry;
  /** Similarity score (0-1, higher is more similar) */
  score: number;
}

/**
 * Configuration for the vector store
 */
export interface VectorStoreConfig {
  /** Maximum number of entries to store (0 = unlimited) */
  maxEntries?: number;
  /** Similarity threshold for search results (0-1) */
  similarityThreshold?: number;
}

/**
 * Default vector store configuration
 */
export const DEFAULT_VECTOR_STORE_CONFIG: VectorStoreConfig = {
  maxEntries: 0,
  similarityThreshold: 0.7,
};

/**
 * Serialized format for persistence
 */
export interface SerializedVectorStore {
  version: number;
  entries: Array<{
    id: string;
    vector: number[];
    metadata?: Record<string, unknown>;
    timestamp: number;
    contentHash?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

/**
 * In-memory vector store with cosine similarity search.
 * Supports persistence via serialization/deserialization.
 */
@injectable()
export class VectorStore {
  private entries: Map<string, VectorEntry> = new Map();
  private config: VectorStoreConfig;
  private createdAt: Date = new Date();
  private updatedAt: Date = new Date();

  constructor(config: Partial<VectorStoreConfig> = {}) {
    this.config = { ...DEFAULT_VECTOR_STORE_CONFIG, ...config };
  }

  /**
   * Update store configuration
   */
  setConfig(config: Partial<VectorStoreConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Add or update a vector entry
   */
  upsert(entry: VectorEntry): void {
    // Validate vector
    if (!entry.vector || entry.vector.length === 0) {
      throw new Error("Vector cannot be empty");
    }

    // Check dimension consistency
    const existingEntry = this.entries.values().next().value as VectorEntry | undefined;
    if (existingEntry && existingEntry.vector.length !== entry.vector.length) {
      throw new Error(
        `Vector dimension mismatch: expected ${existingEntry.vector.length}, got ${entry.vector.length}`
      );
    }

    // Enforce max entries limit (LRU eviction)
    if (
      this.config.maxEntries &&
      this.config.maxEntries > 0 &&
      !this.entries.has(entry.id) &&
      this.entries.size >= this.config.maxEntries
    ) {
      // Find and remove oldest entry
      let oldestId: string | null = null;
      let oldestTimestamp = Infinity;

      for (const [id, e] of this.entries) {
        if (e.timestamp < oldestTimestamp) {
          oldestTimestamp = e.timestamp;
          oldestId = id;
        }
      }

      if (oldestId) {
        this.entries.delete(oldestId);
        LoggingService.debug(`VectorStore: Evicted oldest entry ${oldestId}`);
      }
    }

    this.entries.set(entry.id, entry);
    this.updatedAt = new Date();
  }

  /**
   * Remove a vector entry
   */
  remove(id: string): boolean {
    const deleted = this.entries.delete(id);
    if (deleted) {
      this.updatedAt = new Date();
    }
    return deleted;
  }

  /**
   * Get a specific entry by ID
   */
  get(id: string): VectorEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * Check if an entry exists
   */
  has(id: string): boolean {
    return this.entries.has(id);
  }

  /**
   * Check if entry needs update based on content hash
   */
  needsUpdate(id: string, contentHash: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) {
      return true;
    }
    return entry.contentHash !== contentHash;
  }

  /**
   * Get all entry IDs
   */
  getAllIds(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Get number of entries
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries.clear();
    this.updatedAt = new Date();
  }

  /**
   * Search for similar vectors using cosine similarity
   */
  search(queryVector: number[], limit = 10): SimilarityResult[] {
    if (this.entries.size === 0) {
      return [];
    }

    // Validate query vector dimension
    const firstEntry = this.entries.values().next().value as VectorEntry | undefined;
    if (firstEntry && firstEntry.vector.length !== queryVector.length) {
      throw new Error(
        `Query vector dimension mismatch: expected ${firstEntry.vector.length}, got ${queryVector.length}`
      );
    }

    const results: SimilarityResult[] = [];
    const threshold = this.config.similarityThreshold ?? 0.7;

    for (const entry of this.entries.values()) {
      const score = this.cosineSimilarity(queryVector, entry.vector);

      if (score >= threshold) {
        results.push({ entry, score });
      }
    }

    // Sort by score descending and limit results
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Find similar entries to an existing entry
   */
  findSimilar(id: string, limit = 10): SimilarityResult[] {
    const entry = this.entries.get(id);
    if (!entry) {
      return [];
    }

    const results = this.search(entry.vector, limit + 1);

    // Filter out the query entry itself
    return results.filter((r) => r.entry.id !== id).slice(0, limit);
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same dimension");
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
  }

  /**
   * Serialize the store for persistence
   */
  serialize(): SerializedVectorStore {
    return {
      version: 1,
      entries: Array.from(this.entries.values()).map((entry) => ({
        id: entry.id,
        vector: entry.vector,
        metadata: entry.metadata,
        timestamp: entry.timestamp,
        contentHash: entry.contentHash,
      })),
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  /**
   * Deserialize and load store data
   */
  deserialize(data: SerializedVectorStore): void {
    if (data.version !== 1) {
      throw new Error(`Unsupported VectorStore version: ${data.version}`);
    }

    this.entries.clear();

    for (const entry of data.entries) {
      this.entries.set(entry.id, {
        id: entry.id,
        vector: entry.vector,
        metadata: entry.metadata,
        timestamp: entry.timestamp,
        contentHash: entry.contentHash,
      });
    }

    this.createdAt = new Date(data.createdAt);
    this.updatedAt = new Date(data.updatedAt);

    LoggingService.debug(
      `VectorStore: Loaded ${this.entries.size} entries from persistence`
    );
  }

  /**
   * Get store statistics
   */
  getStats(): {
    entryCount: number;
    dimension: number | null;
    createdAt: string;
    updatedAt: string;
    estimatedMemoryMB: number;
  } {
    const firstEntry = this.entries.values().next().value as VectorEntry | undefined;
    const dimension = firstEntry?.vector.length ?? null;

    // Estimate memory: each float64 is 8 bytes
    const vectorBytes = dimension
      ? this.entries.size * dimension * 8
      : 0;
    const estimatedMemoryMB = vectorBytes / (1024 * 1024);

    return {
      entryCount: this.entries.size,
      dimension,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      estimatedMemoryMB: Math.round(estimatedMemoryMB * 100) / 100,
    };
  }

  /**
   * Remove entries not in the provided set of valid IDs
   * (useful for syncing with vault changes)
   */
  pruneInvalidEntries(validIds: Set<string>): number {
    const idsToRemove: string[] = [];

    for (const id of this.entries.keys()) {
      if (!validIds.has(id)) {
        idsToRemove.push(id);
      }
    }

    for (const id of idsToRemove) {
      this.entries.delete(id);
    }

    if (idsToRemove.length > 0) {
      this.updatedAt = new Date();
      LoggingService.debug(
        `VectorStore: Pruned ${idsToRemove.length} invalid entries`
      );
    }

    return idsToRemove.length;
  }
}

/**
 * IncrementalIndexer - Tracks file modification times for smart cache invalidation
 *
 * Instead of invalidating the entire cache on any file change, this service
 * tracks which files have changed and only invalidates affected cache entries.
 *
 * Features:
 * - File modification time tracking
 * - Batch change detection
 * - Integration with SPARQLResultCache for targeted invalidation
 * - Throttling to prevent excessive re-indexing
 *
 * Performance targets (Issue #1280):
 * - Incremental indexing should complete < 5 seconds
 * - Only process actually modified files
 *
 * @module infrastructure/sparql/cache
 * @since 1.0.0
 */

/**
 * File change type
 */
export type ChangeType = "created" | "modified" | "deleted" | "renamed";

/**
 * Represents a file change event
 */
export interface FileChange {
  /** Path to the file */
  path: string;
  /** Type of change */
  type: ChangeType;
  /** Previous path for rename events */
  oldPath?: string;
  /** Modification timestamp */
  timestamp: number;
}

/**
 * File metadata for tracking
 */
interface FileMetadata {
  /** Last known modification time */
  mtime: number;
  /** Size in bytes */
  size: number;
  /** Hash of content (optional, for content-based invalidation) */
  contentHash?: string;
}

/**
 * Configuration options for IncrementalIndexer
 */
export interface IncrementalIndexerOptions {
  /** Throttle interval in milliseconds (default: 500ms) */
  throttleMs?: number;
  /** Maximum batch size for processing (default: 100 files) */
  maxBatchSize?: number;
  /** Whether to use content hashing for more precise invalidation (default: false) */
  useContentHashing?: boolean;
}

/**
 * Statistics for the incremental indexer
 */
export interface IncrementalIndexerStats {
  /** Number of files currently tracked */
  trackedFiles: number;
  /** Total number of changes processed */
  totalChanges: number;
  /** Number of changes that triggered invalidation */
  invalidations: number;
  /** Number of changes that were no-ops (content unchanged) */
  noOpChanges: number;
  /** Last indexing duration in milliseconds */
  lastIndexDurationMs: number;
  /** Average indexing duration */
  avgIndexDurationMs: number;
  /** Timestamp of last indexing operation */
  lastIndexTime: number;
}

/**
 * Default configuration values
 */
const DEFAULT_OPTIONS: Required<IncrementalIndexerOptions> = {
  throttleMs: 500,
  maxBatchSize: 100,
  useContentHashing: false,
};

/**
 * IncrementalIndexer - Smart file change tracking for cache invalidation
 *
 * @example
 * ```typescript
 * const indexer = new IncrementalIndexer({ throttleMs: 500 });
 * const resultCache = new SPARQLResultCache();
 *
 * // Register callback for invalidation
 * indexer.onInvalidate((changes) => {
 *   for (const change of changes) {
 *     resultCache.invalidateByFile(change.path);
 *   }
 * });
 *
 * // Process a file change event
 * indexer.recordChange({
 *   path: '/path/to/file.md',
 *   type: 'modified',
 *   timestamp: Date.now()
 * });
 *
 * // Check if a file has changed since last index
 * const hasChanged = indexer.hasChanged('/path/to/file.md', currentMtime);
 * ```
 */
export class IncrementalIndexer {
  private readonly options: Required<IncrementalIndexerOptions>;

  /** Map from file path to metadata */
  private readonly fileMetadata: Map<string, FileMetadata> = new Map();

  /** Pending changes to process */
  private pendingChanges: FileChange[] = [];

  /** Throttle timer */
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Invalidation callbacks */
  private invalidateCallbacks: Array<(changes: FileChange[]) => void> = [];

  /** Last indexing timestamp */
  private lastIndexTime = 0;

  /** Statistics */
  private stats = {
    totalChanges: 0,
    invalidations: 0,
    noOpChanges: 0,
    indexDurations: [] as number[],
  };

  constructor(options: IncrementalIndexerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Record a file change event.
   * Changes are batched and processed after the throttle interval.
   *
   * @param change - The file change event
   */
  recordChange(change: FileChange): void {
    this.pendingChanges.push(change);
    this.stats.totalChanges++;

    // Throttle processing
    if (this.throttleTimer === null) {
      this.throttleTimer = setTimeout(() => {
        this.processPendingChanges();
        this.throttleTimer = null;
      }, this.options.throttleMs);
    }
  }

  /**
   * Process pending changes and trigger invalidation.
   */
  private processPendingChanges(): void {
    if (this.pendingChanges.length === 0) {
      return;
    }

    const startTime = performance.now();

    // Deduplicate by path, keeping only the latest change for each file
    const changesByPath = new Map<string, FileChange>();
    for (const change of this.pendingChanges) {
      changesByPath.set(change.path, change);
    }

    const uniqueChanges = Array.from(changesByPath.values());
    const changesToInvalidate: FileChange[] = [];

    // Check each change and update metadata
    for (const change of uniqueChanges) {
      switch (change.type) {
        case "deleted":
          this.fileMetadata.delete(change.path);
          changesToInvalidate.push(change);
          break;

        case "renamed":
          if (change.oldPath) {
            this.fileMetadata.delete(change.oldPath);
          }
          // Fall through to update new path
          changesToInvalidate.push(change);
          break;

        case "created":
        case "modified":
          changesToInvalidate.push(change);
          break;
      }
    }

    // Trigger invalidation callbacks
    if (changesToInvalidate.length > 0) {
      this.stats.invalidations += changesToInvalidate.length;
      for (const callback of this.invalidateCallbacks) {
        try {
          callback(changesToInvalidate);
        } catch (error) {
          console.error("IncrementalIndexer: Error in invalidation callback:", error);
        }
      }
    }

    // Update stats
    const duration = performance.now() - startTime;
    this.stats.indexDurations.push(duration);
    if (this.stats.indexDurations.length > 100) {
      this.stats.indexDurations.shift();
    }
    this.lastIndexTime = Date.now();

    // Clear pending changes
    this.pendingChanges = [];
  }

  /**
   * Force immediate processing of pending changes.
   * Use when you need synchronous invalidation.
   */
  flush(): void {
    if (this.throttleTimer !== null) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.processPendingChanges();
  }

  /**
   * Update file metadata after indexing.
   *
   * @param path - File path
   * @param mtime - Modification time
   * @param size - File size in bytes
   * @param contentHash - Optional content hash
   */
  updateMetadata(path: string, mtime: number, size: number, contentHash?: string): void {
    this.fileMetadata.set(path, { mtime, size, contentHash });
  }

  /**
   * Check if a file has changed since it was last indexed.
   *
   * @param path - File path
   * @param currentMtime - Current modification time
   * @param currentSize - Current file size
   * @returns true if the file has changed
   */
  hasChanged(path: string, currentMtime: number, currentSize?: number): boolean {
    const metadata = this.fileMetadata.get(path);

    if (metadata === undefined) {
      // New file, not seen before
      return true;
    }

    // Check modification time
    if (metadata.mtime !== currentMtime) {
      return true;
    }

    // Check size if provided
    if (currentSize !== undefined && metadata.size !== currentSize) {
      return true;
    }

    return false;
  }

  /**
   * Get all files that have changed since a given timestamp.
   *
   * @param sinceTimestamp - Timestamp to check against
   * @returns Array of file paths that have changed
   */
  getChangedFiles(sinceTimestamp: number): string[] {
    const changed: string[] = [];

    for (const [path, metadata] of this.fileMetadata.entries()) {
      if (metadata.mtime > sinceTimestamp) {
        changed.push(path);
      }
    }

    return changed;
  }

  /**
   * Register a callback to be called when files need invalidation.
   *
   * @param callback - Function to call with changed files
   * @returns Unsubscribe function
   */
  onInvalidate(callback: (changes: FileChange[]) => void): () => void {
    this.invalidateCallbacks.push(callback);
    return () => {
      const index = this.invalidateCallbacks.indexOf(callback);
      if (index !== -1) {
        this.invalidateCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Get statistics about the indexer.
   *
   * @returns Indexer statistics
   */
  getStats(): IncrementalIndexerStats {
    const durations = this.stats.indexDurations;
    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;
    const lastDuration = durations.length > 0
      ? durations[durations.length - 1]
      : 0;

    return {
      trackedFiles: this.fileMetadata.size,
      totalChanges: this.stats.totalChanges,
      invalidations: this.stats.invalidations,
      noOpChanges: this.stats.noOpChanges,
      lastIndexDurationMs: lastDuration,
      avgIndexDurationMs: avgDuration,
      lastIndexTime: this.lastIndexTime,
    };
  }

  /**
   * Reset statistics counters.
   */
  resetStats(): void {
    this.stats = {
      totalChanges: 0,
      invalidations: 0,
      noOpChanges: 0,
      indexDurations: [],
    };
  }

  /**
   * Clear all tracked file metadata.
   */
  clear(): void {
    this.fileMetadata.clear();
    this.pendingChanges = [];
    if (this.throttleTimer !== null) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
  }

  /**
   * Get the number of tracked files.
   */
  size(): number {
    return this.fileMetadata.size;
  }

  /**
   * Check if a file is being tracked.
   *
   * @param path - File path
   * @returns true if the file is tracked
   */
  isTracked(path: string): boolean {
    return this.fileMetadata.has(path);
  }

  /**
   * Get metadata for a specific file.
   *
   * @param path - File path
   * @returns File metadata or undefined
   */
  getMetadata(path: string): FileMetadata | undefined {
    return this.fileMetadata.get(path);
  }

  /**
   * Dispose of the indexer and cleanup resources.
   */
  dispose(): void {
    if (this.throttleTimer !== null) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.invalidateCallbacks = [];
    this.pendingChanges = [];
    this.fileMetadata.clear();
  }
}

/**
 * Create a new IncrementalIndexer instance.
 *
 * @param options - Indexer configuration options
 * @returns New indexer instance
 */
export function createIncrementalIndexer(
  options?: IncrementalIndexerOptions
): IncrementalIndexer {
  return new IncrementalIndexer(options);
}

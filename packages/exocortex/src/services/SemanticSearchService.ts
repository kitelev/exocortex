import { injectable } from "tsyringe";
import { LoggingService } from "./LoggingService";
import {
  EmbeddingService,
  EmbeddingConfig,
  EmbeddingRequest,
  DEFAULT_EMBEDDING_CONFIG,
} from "./EmbeddingService";
import {
  VectorStore,
  SimilarityResult,
  SerializedVectorStore,
} from "./VectorStore";

/**
 * Configuration for semantic search service
 */
export interface SemanticSearchConfig {
  /** Embedding configuration */
  embedding: Partial<EmbeddingConfig>;
  /** Maximum number of search results */
  maxResults: number;
  /** Minimum similarity score (0-1) */
  minSimilarity: number;
  /** Whether to auto-embed new/changed files */
  autoEmbed: boolean;
  /** Batch size for embedding operations */
  batchSize: number;
}

/**
 * Default semantic search configuration
 */
export const DEFAULT_SEMANTIC_SEARCH_CONFIG: SemanticSearchConfig = {
  embedding: DEFAULT_EMBEDDING_CONFIG,
  maxResults: 10,
  minSimilarity: 0.7,
  autoEmbed: true,
  batchSize: 20,
};

/**
 * Result of a semantic search query
 */
export interface SemanticSearchResult {
  /** File path */
  path: string;
  /** Similarity score (0-1) */
  score: number;
  /** Asset label if available */
  label?: string;
  /** Instance class if available */
  instanceClass?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Status of embedding indexing
 */
export interface IndexingStatus {
  /** Whether indexing is in progress */
  isIndexing: boolean;
  /** Total files to index */
  totalFiles: number;
  /** Files indexed so far */
  indexedFiles: number;
  /** Files that failed to index */
  failedFiles: number;
  /** Progress percentage (0-100) */
  progress: number;
}

/**
 * Callback for file content retrieval
 */
export type FileContentProvider = (
  path: string
) => Promise<{ content: string; metadata?: Record<string, unknown> } | null>;

/**
 * Service for semantic search using vector embeddings.
 * Integrates EmbeddingService and VectorStore to provide
 * similarity-based search across vault notes.
 */
@injectable()
export class SemanticSearchService {
  private embeddingService: EmbeddingService;
  private vectorStore: VectorStore;
  private config: SemanticSearchConfig;
  private indexingStatus: IndexingStatus = {
    isIndexing: false,
    totalFiles: 0,
    indexedFiles: 0,
    failedFiles: 0,
    progress: 0,
  };
  private abortController: AbortController | null = null;

  constructor(config: Partial<SemanticSearchConfig> = {}) {
    this.config = { ...DEFAULT_SEMANTIC_SEARCH_CONFIG, ...config };
    this.embeddingService = new EmbeddingService(this.config.embedding);
    this.vectorStore = new VectorStore({
      similarityThreshold: this.config.minSimilarity,
    });
  }

  /**
   * Update service configuration
   */
  setConfig(config: Partial<SemanticSearchConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.embedding) {
      this.embeddingService.setConfig(config.embedding);
    }

    if (config.minSimilarity !== undefined) {
      this.vectorStore.setConfig({ similarityThreshold: config.minSimilarity });
    }
  }

  /**
   * Get current configuration (without sensitive data)
   */
  getConfig(): Omit<SemanticSearchConfig, "embedding"> & {
    embedding: Omit<EmbeddingConfig, "apiKey">;
  } {
    return {
      ...this.config,
      embedding: this.embeddingService.getConfig(),
    };
  }

  /**
   * Check if the service is properly configured
   */
  isConfigured(): boolean {
    return this.embeddingService.isConfigured();
  }

  /**
   * Get indexing status
   */
  getIndexingStatus(): IndexingStatus {
    return { ...this.indexingStatus };
  }

  /**
   * Search for semantically similar notes
   */
  async search(query: string, limit?: number): Promise<SemanticSearchResult[]> {
    if (!this.isConfigured()) {
      throw new Error("SemanticSearchService is not properly configured");
    }

    if (!query.trim()) {
      return [];
    }

    // Generate embedding for the query
    const queryResult = await this.embeddingService.generateEmbedding(query);

    // Search in vector store
    const maxResults = limit ?? this.config.maxResults;
    const results = this.vectorStore.search(queryResult.embedding, maxResults);

    return results.map((r) => this.toSearchResult(r));
  }

  /**
   * Find notes similar to a specific note
   */
  async findSimilar(
    path: string,
    limit?: number
  ): Promise<SemanticSearchResult[]> {
    const maxResults = limit ?? this.config.maxResults;
    const results = this.vectorStore.findSimilar(path, maxResults);
    return results.map((r) => this.toSearchResult(r));
  }

  /**
   * Convert similarity result to search result
   */
  private toSearchResult(result: SimilarityResult): SemanticSearchResult {
    const metadata = result.entry.metadata ?? {};
    return {
      path: result.entry.id,
      score: result.score,
      label: metadata.exo__Asset_label as string | undefined,
      instanceClass: this.extractInstanceClass(metadata),
      metadata,
    };
  }

  /**
   * Extract instance class from metadata
   */
  private extractInstanceClass(
    metadata: Record<string, unknown>
  ): string | undefined {
    const instanceClass = metadata.exo__Instance_class;
    if (!instanceClass) {
      return undefined;
    }

    if (Array.isArray(instanceClass)) {
      const first = instanceClass[0];
      return typeof first === "string" ? this.cleanWikiLink(first) : undefined;
    }

    return typeof instanceClass === "string"
      ? this.cleanWikiLink(instanceClass)
      : undefined;
  }

  /**
   * Clean wiki-link format from string
   */
  private cleanWikiLink(value: string): string {
    return value
      .replace(/^\[\[/, "")
      .replace(/\]\]$/, "")
      .replace(/^"/, "")
      .replace(/"$/, "");
  }

  /**
   * Index a single file
   */
  async indexFile(
    path: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    try {
      // Generate content hash
      const contentHash = await this.hashContent(content);

      // Skip if already indexed and unchanged
      if (!this.vectorStore.needsUpdate(path, contentHash)) {
        return true;
      }

      // Prepare text and generate embedding
      const text = this.embeddingService.prepareTextForEmbedding(
        content,
        metadata
      );
      const result = await this.embeddingService.generateEmbedding(text);

      // Store in vector store
      this.vectorStore.upsert({
        id: path,
        vector: result.embedding,
        metadata,
        timestamp: Date.now(),
        contentHash,
      });

      LoggingService.debug(`Indexed file: ${path}`);
      return true;
    } catch (error) {
      LoggingService.warn(
        `Failed to index file ${path}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      return false;
    }
  }

  /**
   * Remove a file from the index
   */
  removeFromIndex(path: string): boolean {
    return this.vectorStore.remove(path);
  }

  /**
   * Batch index multiple files
   */
  async indexBatch(
    files: Array<{
      path: string;
      content: string;
      metadata?: Record<string, unknown>;
    }>
  ): Promise<{ indexed: number; failed: number }> {
    if (!this.isConfigured()) {
      return { indexed: 0, failed: files.length };
    }

    const requests: EmbeddingRequest[] = [];
    const fileMap = new Map<
      string,
      { content: string; metadata?: Record<string, unknown>; contentHash: string }
    >();

    // Prepare requests, skipping unchanged files
    for (const file of files) {
      const contentHash = await this.hashContent(file.content);

      if (!this.vectorStore.needsUpdate(file.path, contentHash)) {
        continue;
      }

      const text = this.embeddingService.prepareTextForEmbedding(
        file.content,
        file.metadata
      );

      requests.push({ id: file.path, text });
      fileMap.set(file.path, {
        content: file.content,
        metadata: file.metadata,
        contentHash,
      });
    }

    if (requests.length === 0) {
      return { indexed: 0, failed: 0 };
    }

    // Generate embeddings in batch
    const results = await this.embeddingService.generateBatchEmbeddings(
      requests
    );

    let indexed = 0;
    let failed = 0;

    for (const result of results) {
      const fileData = fileMap.get(result.id);
      if (!fileData) {
        continue;
      }

      if (result.result) {
        this.vectorStore.upsert({
          id: result.id,
          vector: result.result.embedding,
          metadata: fileData.metadata,
          timestamp: Date.now(),
          contentHash: fileData.contentHash,
        });
        indexed++;
      } else {
        failed++;
        LoggingService.warn(
          `Failed to embed ${result.id}: ${result.error || "Unknown error"}`
        );
      }
    }

    return { indexed, failed };
  }

  /**
   * Index all files from a provider
   * Can be aborted by calling abortIndexing()
   */
  async indexAll(
    filePaths: string[],
    contentProvider: FileContentProvider,
    progressCallback?: (status: IndexingStatus) => void
  ): Promise<{ indexed: number; failed: number; aborted: boolean }> {
    if (!this.isConfigured()) {
      throw new Error("SemanticSearchService is not properly configured");
    }

    if (this.indexingStatus.isIndexing) {
      throw new Error("Indexing is already in progress");
    }

    this.abortController = new AbortController();
    this.indexingStatus = {
      isIndexing: true,
      totalFiles: filePaths.length,
      indexedFiles: 0,
      failedFiles: 0,
      progress: 0,
    };

    let totalIndexed = 0;
    let totalFailed = 0;
    let aborted = false;

    try {
      // Process in batches
      for (
        let i = 0;
        i < filePaths.length;
        i += this.config.batchSize
      ) {
        // Check for abort
        if (this.abortController.signal.aborted) {
          aborted = true;
          break;
        }

        const batchPaths = filePaths.slice(i, i + this.config.batchSize);
        const batchFiles: Array<{
          path: string;
          content: string;
          metadata?: Record<string, unknown>;
        }> = [];

        // Load file contents
        for (const path of batchPaths) {
          if (this.abortController.signal.aborted) {
            aborted = true;
            break;
          }

          const fileData = await contentProvider(path);
          if (fileData) {
            batchFiles.push({
              path,
              content: fileData.content,
              metadata: fileData.metadata,
            });
          } else {
            totalFailed++;
          }
        }

        if (aborted) {
          break;
        }

        // Index batch
        const result = await this.indexBatch(batchFiles);
        totalIndexed += result.indexed;
        totalFailed += result.failed;

        // Update status
        this.indexingStatus.indexedFiles = i + batchPaths.length;
        this.indexingStatus.failedFiles = totalFailed;
        this.indexingStatus.progress = Math.round(
          (this.indexingStatus.indexedFiles / filePaths.length) * 100
        );

        if (progressCallback) {
          progressCallback({ ...this.indexingStatus });
        }
      }
    } finally {
      this.indexingStatus.isIndexing = false;
      this.abortController = null;
    }

    return { indexed: totalIndexed, failed: totalFailed, aborted };
  }

  /**
   * Abort ongoing indexing
   */
  abortIndexing(): void {
    if (this.abortController) {
      this.abortController.abort();
      LoggingService.debug("Indexing aborted by user");
    }
  }

  /**
   * Check if file is already indexed
   */
  isIndexed(path: string): boolean {
    return this.vectorStore.has(path);
  }

  /**
   * Get all indexed file paths
   */
  getIndexedPaths(): string[] {
    return this.vectorStore.getAllIds();
  }

  /**
   * Get number of indexed files
   */
  getIndexedCount(): number {
    return this.vectorStore.size();
  }

  /**
   * Clear the entire index
   */
  clearIndex(): void {
    this.vectorStore.clear();
    LoggingService.debug("Semantic search index cleared");
  }

  /**
   * Prune entries for deleted files
   */
  pruneDeletedFiles(existingPaths: Set<string>): number {
    return this.vectorStore.pruneInvalidEntries(existingPaths);
  }

  /**
   * Serialize the index for persistence
   */
  serializeIndex(): SerializedVectorStore {
    return this.vectorStore.serialize();
  }

  /**
   * Deserialize and load index data
   */
  deserializeIndex(data: SerializedVectorStore): void {
    this.vectorStore.deserialize(data);
  }

  /**
   * Get store statistics
   */
  getStats(): {
    indexStats: ReturnType<VectorStore["getStats"]>;
    embeddingStats: ReturnType<EmbeddingService["getStats"]>;
  } {
    return {
      indexStats: this.vectorStore.getStats(),
      embeddingStats: this.embeddingService.getStats(),
    };
  }

  /**
   * Generate content hash for change detection
   */
  private async hashContent(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);

    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
}

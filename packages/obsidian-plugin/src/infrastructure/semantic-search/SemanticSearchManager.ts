import { App, TFile, TAbstractFile } from "obsidian";
import {
  SemanticSearchService,
  SemanticSearchResult,
  IndexingStatus,
  SerializedVectorStore,
  LoggingService,
} from "exocortex";
import type { SemanticSearchSettings } from "../../domain/settings/ExocortexSettings";

/**
 * Manages semantic search integration with Obsidian.
 * Handles file indexing, search, and persistence.
 */
export class SemanticSearchManager {
  private app: App;
  private service: SemanticSearchService;
  private settings: SemanticSearchSettings;
  private isInitialized = false;
  private indexPath = ".exocortex/semantic-index.json";
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingFilePaths = new Set<string>();
  private indexingDebounceMs = 2000;

  constructor(app: App, settings: SemanticSearchSettings) {
    this.app = app;
    this.settings = settings;
    this.service = new SemanticSearchService({
      embedding: {
        provider: settings.provider,
        apiKey: settings.apiKey,
        model: settings.model,
      },
      maxResults: settings.maxResults,
      minSimilarity: settings.minSimilarity,
      autoEmbed: settings.autoEmbed,
    });
  }

  /**
   * Initialize the manager and load persisted index
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (!this.settings.enabled) {
      LoggingService.debug("SemanticSearchManager: Disabled in settings");
      return;
    }

    await this.loadIndex();
    this.isInitialized = true;
    LoggingService.debug("SemanticSearchManager: Initialized");
  }

  /**
   * Update settings
   */
  updateSettings(settings: SemanticSearchSettings): void {
    this.settings = settings;
    this.service.setConfig({
      embedding: {
        provider: settings.provider,
        apiKey: settings.apiKey,
        model: settings.model,
      },
      maxResults: settings.maxResults,
      minSimilarity: settings.minSimilarity,
      autoEmbed: settings.autoEmbed,
    });
  }

  /**
   * Check if the service is properly configured
   */
  isConfigured(): boolean {
    return this.settings.enabled && this.service.isConfigured();
  }

  /**
   * Search for semantically similar notes
   */
  async search(query: string, limit?: number): Promise<SemanticSearchResult[]> {
    if (!this.isConfigured()) {
      return [];
    }
    return this.service.search(query, limit);
  }

  /**
   * Find notes similar to a specific note
   */
  async findSimilar(
    file: TFile,
    limit?: number
  ): Promise<SemanticSearchResult[]> {
    if (!this.isConfigured()) {
      return [];
    }
    return this.service.findSimilar(file.path, limit);
  }

  /**
   * Handle file creation event
   */
  async handleFileCreate(file: TAbstractFile): Promise<void> {
    if (!this.shouldIndex(file)) {
      return;
    }

    this.queueFileForIndexing(file.path);
  }

  /**
   * Handle file modification event
   */
  async handleFileModify(file: TFile): Promise<void> {
    if (!this.shouldIndex(file)) {
      return;
    }

    this.queueFileForIndexing(file.path);
  }

  /**
   * Handle file deletion event
   */
  handleFileDelete(file: TAbstractFile): void {
    if (!(file instanceof TFile) || !file.path.endsWith(".md")) {
      return;
    }

    this.service.removeFromIndex(file.path);
    this.scheduleSave();
  }

  /**
   * Handle file rename event
   */
  async handleFileRename(
    file: TAbstractFile,
    oldPath: string
  ): Promise<void> {
    if (!(file instanceof TFile) || !file.path.endsWith(".md")) {
      return;
    }

    // Remove old path from index
    this.service.removeFromIndex(oldPath);

    // Re-index with new path
    if (this.shouldIndex(file)) {
      await this.indexFile(file);
    }
  }

  /**
   * Check if file should be indexed
   */
  private shouldIndex(file: TAbstractFile): boolean {
    if (!this.isConfigured()) {
      return false;
    }

    if (!this.settings.autoEmbed) {
      return false;
    }

    if (!(file instanceof TFile)) {
      return false;
    }

    if (!file.path.endsWith(".md")) {
      return false;
    }

    // Skip internal exocortex files
    if (file.path.startsWith(".exocortex/")) {
      return false;
    }

    return true;
  }

  /**
   * Queue file for indexing with debouncing
   */
  private queueFileForIndexing(path: string): void {
    this.pendingFilePaths.add(path);
    this.scheduleBatchIndexing();
  }

  /**
   * Schedule batch indexing with debounce
   */
  private scheduleBatchIndexing(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(async () => {
      const paths = Array.from(this.pendingFilePaths);
      this.pendingFilePaths.clear();

      if (paths.length === 0) {
        return;
      }

      const files: Array<{
        path: string;
        content: string;
        metadata?: Record<string, unknown>;
      }> = [];

      for (const path of paths) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          const content = await this.app.vault.cachedRead(file);
          const cache = this.app.metadataCache.getFileCache(file);
          files.push({
            path,
            content,
            metadata: cache?.frontmatter,
          });
        }
      }

      if (files.length > 0) {
        await this.service.indexBatch(files);
        this.scheduleSave();
      }
    }, this.indexingDebounceMs);
  }

  /**
   * Index a single file
   */
  private async indexFile(file: TFile): Promise<boolean> {
    const content = await this.app.vault.cachedRead(file);
    const cache = this.app.metadataCache.getFileCache(file);

    const success = await this.service.indexFile(
      file.path,
      content,
      cache?.frontmatter
    );

    if (success) {
      this.scheduleSave();
    }

    return success;
  }

  /**
   * Index all markdown files in the vault
   */
  async indexAll(
    progressCallback?: (status: IndexingStatus) => void
  ): Promise<{ indexed: number; failed: number; aborted: boolean }> {
    if (!this.isConfigured()) {
      throw new Error("Semantic search is not properly configured");
    }

    const files = this.app.vault.getMarkdownFiles();
    const filePaths = files
      .filter((f) => !f.path.startsWith(".exocortex/"))
      .map((f) => f.path);

    const result = await this.service.indexAll(
      filePaths,
      async (path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
          return null;
        }
        const content = await this.app.vault.cachedRead(file);
        const cache = this.app.metadataCache.getFileCache(file);
        return { content, metadata: cache?.frontmatter };
      },
      progressCallback
    );

    await this.saveIndex();
    return result;
  }

  /**
   * Abort ongoing indexing
   */
  abortIndexing(): void {
    this.service.abortIndexing();
  }

  /**
   * Get indexing status
   */
  getIndexingStatus(): IndexingStatus {
    return this.service.getIndexingStatus();
  }

  /**
   * Get number of indexed files
   */
  getIndexedCount(): number {
    return this.service.getIndexedCount();
  }

  /**
   * Clear the entire index
   */
  async clearIndex(): Promise<void> {
    this.service.clearIndex();
    await this.deleteIndex();
    LoggingService.debug("SemanticSearchManager: Index cleared");
  }

  /**
   * Sync index with vault (remove deleted files)
   */
  async syncWithVault(): Promise<number> {
    const files = this.app.vault.getMarkdownFiles();
    const existingPaths = new Set(files.map((f) => f.path));
    const pruned = this.service.pruneDeletedFiles(existingPaths);

    if (pruned > 0) {
      await this.saveIndex();
    }

    return pruned;
  }

  /**
   * Schedule index save with debounce
   */
  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      this.saveIndex().catch((error) => {
        LoggingService.warn(
          `Failed to save semantic index: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      });
    }, 5000);
  }

  /**
   * Save index to vault
   */
  private async saveIndex(): Promise<void> {
    const data = this.service.serializeIndex();
    const content = JSON.stringify(data, null, 2);

    // Ensure directory exists
    const dir = this.indexPath.split("/").slice(0, -1).join("/");
    if (dir && !(await this.app.vault.adapter.exists(dir))) {
      await this.app.vault.adapter.mkdir(dir);
    }

    await this.app.vault.adapter.write(this.indexPath, content);
    LoggingService.debug(
      `SemanticSearchManager: Saved index (${data.entries.length} entries)`
    );
  }

  /**
   * Load index from vault
   */
  private async loadIndex(): Promise<void> {
    try {
      if (!(await this.app.vault.adapter.exists(this.indexPath))) {
        LoggingService.debug("SemanticSearchManager: No existing index found");
        return;
      }

      const content = await this.app.vault.adapter.read(this.indexPath);
      const data = JSON.parse(content) as SerializedVectorStore;
      this.service.deserializeIndex(data);

      LoggingService.debug(
        `SemanticSearchManager: Loaded index (${data.entries.length} entries)`
      );
    } catch (error) {
      LoggingService.warn(
        `Failed to load semantic index: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Delete index file
   */
  private async deleteIndex(): Promise<void> {
    try {
      if (await this.app.vault.adapter.exists(this.indexPath)) {
        await this.app.vault.adapter.remove(this.indexPath);
      }
    } catch (error) {
      LoggingService.warn(
        `Failed to delete semantic index: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Get statistics
   */
  getStats(): ReturnType<SemanticSearchService["getStats"]> {
    return this.service.getStats();
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.pendingFilePaths.clear();
    this.isInitialized = false;
  }
}

import { App as ObsidianApp, TFile, EventRef, debounce } from "obsidian";

/**
 * Default debounce delay in milliseconds for cache invalidation.
 * Prevents excessive re-computation when multiple file changes occur rapidly.
 */
const DEFAULT_DEBOUNCE_DELAY = 100;

export class BacklinksCacheManager {
  private backlinksCache: Map<string, Set<string>> = new Map();
  private cacheValid = false;
  private eventRefs: EventRef[] = [];
  private pendingInvalidations: Set<string> = new Set();
  private debouncedProcessInvalidations: () => void;

  constructor(
    private app: ObsidianApp,
    debounceDelay: number = DEFAULT_DEBOUNCE_DELAY
  ) {
    this.debouncedProcessInvalidations = debounce(
      () => this.processInvalidations(),
      debounceDelay,
      false
    );
  }

  /**
   * Registers vault event listeners for automatic cache invalidation.
   * Should be called after plugin initialization.
   */
  registerEventListeners(): void {
    this.eventRefs.push(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) {
          this.invalidateFor(file.path);
        }
      })
    );

    this.eventRefs.push(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          this.invalidateFor(file.path);
        }
      })
    );

    this.eventRefs.push(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile) {
          this.invalidateFor(file.path);
        }
      })
    );

    this.eventRefs.push(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) {
          this.invalidateFor(oldPath);
          this.invalidateFor(file.path);
        }
      })
    );
  }

  /**
   * Unregisters all vault event listeners.
   * Should be called before cleanup() in plugin unload.
   */
  unregisterEventListeners(): void {
    this.eventRefs.forEach((ref) => {
      this.app.vault.offref(ref);
    });
    this.eventRefs = [];
  }

  /**
   * Schedules partial invalidation for a specific path.
   * Uses debouncing to batch rapid changes together.
   */
  invalidateFor(path: string): void {
    this.pendingInvalidations.add(path);
    this.debouncedProcessInvalidations();
  }

  /**
   * Processes all pending invalidations, removing affected cache entries.
   * Implements partial invalidation - only removes entries that reference
   * the changed paths, rather than invalidating the entire cache.
   */
  private processInvalidations(): void {
    if (this.pendingInvalidations.size === 0) {
      return;
    }

    const pathsToInvalidate = new Set(this.pendingInvalidations);
    this.pendingInvalidations.clear();

    // For each path that changed, remove its direct cache entry
    for (const path of pathsToInvalidate) {
      this.backlinksCache.delete(path);
    }

    // For each cached entry, check if it references any invalidated paths
    // If so, mark the cache as invalid (to trigger full rebuild)
    for (const [, links] of this.backlinksCache) {
      for (const path of pathsToInvalidate) {
        if (links.has(path)) {
          // This file had a backlink from a modified file
          // We need to rebuild to get accurate backlinks
          this.cacheValid = false;
          return;
        }
      }
    }

    // If we're still valid after partial cleanup, check if we removed entries
    // but there are still pending cached entries that might be affected
    if (pathsToInvalidate.size > 0 && this.cacheValid) {
      // Mark as invalid to ensure fresh data on next access
      this.cacheValid = false;
    }
  }

  buildCache(): void {
    if (this.cacheValid) return;

    this.backlinksCache.clear();
    const resolvedLinks = this.app.metadataCache.resolvedLinks;

    for (const sourcePath in resolvedLinks) {
      const links = resolvedLinks[sourcePath];
      for (const targetPath in links) {
        this.addBacklink(targetPath, sourcePath);
      }
    }

    // Resolve unresolved links via UID→path mapping.
    // When files use human-readable filenames but wikilinks reference by UUID
    // (e.g. [[uuid|alias]]), Obsidian can't resolve the link → 0 backlinks.
    // Build a UID→path index and use unresolvedLinks to recover these backlinks.
    this.resolveUidBacklinks();

    this.cacheValid = true;
  }

  private resolveUidBacklinks(): void {
    const uidToPath = new Map<string, string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      const uid = cache?.frontmatter?.exo__Asset_uid;
      if (uid && typeof uid === "string") {
        uidToPath.set(uid, file.path);
      }
    }

    if (uidToPath.size === 0) return;

    const unresolvedLinks = this.app.metadataCache.unresolvedLinks;
    for (const sourcePath in unresolvedLinks) {
      const links = unresolvedLinks[sourcePath];
      for (const linkTarget in links) {
        const resolvedPath = uidToPath.get(linkTarget);
        if (resolvedPath) {
          this.addBacklink(resolvedPath, sourcePath);
        }
      }
    }
  }

  private addBacklink(targetPath: string, sourcePath: string): void {
    const existing = this.backlinksCache.get(targetPath);
    if (!existing) {
      this.backlinksCache.set(targetPath, new Set([sourcePath]));
    } else {
      existing.add(sourcePath);
    }
  }

  invalidate(): void {
    this.cacheValid = false;
  }

  getBacklinks(targetPath: string): Set<string> | undefined {
    this.buildCache();
    return this.backlinksCache.get(targetPath);
  }

  isValid(): boolean {
    return this.cacheValid;
  }

  /**
   * Returns the current number of entries in the cache.
   */
  get size(): number {
    return this.backlinksCache.size;
  }

  /**
   * Returns the number of pending invalidations waiting to be processed.
   * Useful for testing debounce behavior.
   */
  get pendingInvalidationCount(): number {
    return this.pendingInvalidations.size;
  }

  /**
   * Clears all entries from the cache and marks it as invalid.
   * Also unregisters event listeners and clears pending invalidations.
   * Should be called in onunload() or cleanup() methods.
   */
  cleanup(): void {
    this.unregisterEventListeners();
    this.backlinksCache.clear();
    this.pendingInvalidations.clear();
    this.cacheValid = false;
  }
}

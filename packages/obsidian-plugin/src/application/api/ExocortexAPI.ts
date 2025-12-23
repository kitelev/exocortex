import { TFile, EventRef } from "obsidian";
import type ExocortexPlugin from '@plugin/ExocortexPlugin';
import { AssetMetadataService } from '@plugin/presentation/renderers/layout/helpers/AssetMetadataService';
import { BacklinksCacheManager } from '@plugin/adapters/caching/BacklinksCacheManager';
import { BlockerHelpers } from '@plugin/presentation/utils/BlockerHelpers';
import { MetadataHelpers } from "exocortex";
import { LoggerFactory } from '@plugin/adapters/logging/LoggerFactory';
import type { ILogger } from '@plugin/adapters/logging/ILogger';

/**
 * Metadata for an asset in the Exocortex knowledge graph.
 * Contains both core Exocortex properties and arbitrary frontmatter.
 */
export interface AssetMetadata {
  /** File path relative to vault root */
  path: string;
  /** Asset label from exo__Asset_label or prototype fallback */
  label: string | null;
  /** Instance class (e.g., "ems__Task", "ems__Project") */
  class: string | null;
  /** Status (e.g., "DOING", "DONE") */
  status: string | null;
  /** Prototype path for inherited properties */
  prototype: string | null;
  /** Unique identifier */
  uid: string | null;
  /** Whether the asset is archived */
  isArchived: boolean;
  /** Whether the asset is blocked by another effort */
  isBlocked: boolean;
  /** Full frontmatter for custom property access */
  [key: string]: unknown;
}

/**
 * Relation between assets in the knowledge graph.
 * Represents a reference from one asset to another via frontmatter property or body link.
 */
export interface AssetRelation {
  /** Source asset path (the file containing the reference) */
  sourcePath: string;
  /** Target asset path (the referenced file) */
  targetPath: string;
  /** Property name if referenced in frontmatter, undefined if body link */
  propertyName: string | undefined;
  /** Whether this is a body link (not in frontmatter) */
  isBodyLink: boolean;
  /** Source asset label */
  sourceLabel: string | null;
  /** Source asset metadata */
  sourceMetadata: AssetMetadata;
}

/**
 * Event callback types for Exocortex API events.
 */
export type LabelChangedCallback = (
  path: string,
  oldLabel: string | null,
  newLabel: string | null
) => void;

export type MetadataChangedCallback = (
  path: string,
  metadata: AssetMetadata
) => void;

/**
 * Event types supported by the Exocortex API.
 */
export type ExocortexEventType = 'label-changed' | 'metadata-changed';

/**
 * Public API for external plugin integration with Exocortex.
 *
 * Provides programmatic access to:
 * - Asset labels and metadata
 * - Asset relationships (backlinks and forward references)
 * - Event notifications for changes
 *
 * @example Basic usage in another plugin
 * ```typescript
 * const exocortex = app.plugins.getPlugin('exocortex');
 * if (exocortex?.api) {
 *   // Get label for a file
 *   const label = exocortex.api.getAssetLabel(file.path);
 *
 *   // Get full metadata
 *   const metadata = exocortex.api.getAssetMetadata(file.path);
 *
 *   // Listen for label changes
 *   exocortex.api.on('label-changed', (path, oldLabel, newLabel) => {
 *     console.log(`Label changed: ${oldLabel} → ${newLabel}`);
 *   });
 * }
 * ```
 */
export class ExocortexAPI {
  private logger: ILogger;
  private metadataService: AssetMetadataService;
  private backlinksCacheManager: BacklinksCacheManager;
  private labelChangedCallbacks: Set<LabelChangedCallback> = new Set();
  private metadataChangedCallbacks: Set<MetadataChangedCallback> = new Set();
  private metadataEventRef: EventRef | null = null;
  private previousLabels: Map<string, string | null> = new Map();

  constructor(private plugin: ExocortexPlugin) {
    this.logger = LoggerFactory.create("ExocortexAPI");
    this.metadataService = new AssetMetadataService(plugin.app);
    this.backlinksCacheManager = new BacklinksCacheManager(plugin.app);

    // Set up metadata change listener for event propagation
    this.setupMetadataListener();

    this.logger.info("ExocortexAPI initialized");
  }

  /**
   * Gets the semantic label for an asset.
   *
   * Resolves the label in the following order:
   * 1. Direct exo__Asset_label property
   * 2. Inherited label from prototype
   * 3. null if no label is found
   *
   * @param path - File path relative to vault root (e.g., "folder/note.md")
   * @returns The asset label, or null if not found
   *
   * @example
   * ```typescript
   * const label = api.getAssetLabel('tasks/my-task.md');
   * console.log(label); // "My Important Task"
   * ```
   */
  getAssetLabel(path: string): string | null {
    return this.metadataService.getAssetLabel(path);
  }

  /**
   * Gets labels for multiple assets in a single call.
   *
   * @param paths - Array of file paths
   * @returns Map of path to label (null for assets without labels)
   *
   * @example
   * ```typescript
   * const labels = api.getAssetLabels(['task1.md', 'task2.md', 'task3.md']);
   * labels.forEach((label, path) => {
   *   console.log(`${path}: ${label ?? 'No label'}`);
   * });
   * ```
   */
  getAssetLabels(paths: string[]): Map<string, string | null> {
    const result = new Map<string, string | null>();
    for (const path of paths) {
      result.set(path, this.getAssetLabel(path));
    }
    return result;
  }

  /**
   * Gets full metadata for an asset.
   *
   * Returns structured metadata including:
   * - Semantic label (with prototype fallback)
   * - Instance class
   * - Status
   * - Archive/blocked state
   * - All frontmatter properties
   *
   * @param path - File path relative to vault root
   * @returns Asset metadata, or null if file not found
   *
   * @example
   * ```typescript
   * const metadata = api.getAssetMetadata('tasks/my-task.md');
   * if (metadata) {
   *   console.log(`Class: ${metadata.class}`);
   *   console.log(`Status: ${metadata.status}`);
   *   console.log(`Is blocked: ${metadata.isBlocked}`);
   * }
   * ```
   */
  getAssetMetadata(path: string): AssetMetadata | null {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return null;
    }

    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter || {};

    const label = this.metadataService.getAssetLabel(path);
    const instanceClass = this.extractInstanceClass(frontmatter);
    const status = this.extractStatus(frontmatter);
    const prototype = this.extractPrototype(frontmatter);
    const uid = frontmatter.exo__Asset_uid as string | undefined;
    const isArchived = MetadataHelpers.isAssetArchived(frontmatter);
    const isBlocked = BlockerHelpers.isEffortBlocked(this.plugin.app, frontmatter);

    return {
      path,
      label,
      class: instanceClass,
      status,
      prototype,
      uid: uid ?? null,
      isArchived,
      isBlocked,
      ...frontmatter,
    };
  }

  /**
   * Gets all relations (backlinks) pointing to an asset.
   *
   * Relations include:
   * - Frontmatter property references (e.g., ems__Effort_parent: [[target]])
   * - Body wiki-links (e.g., [[target]])
   *
   * @param path - File path relative to vault root
   * @returns Array of relations, empty if none found
   *
   * @example
   * ```typescript
   * const relations = api.getAssetRelations('projects/my-project.md');
   * relations.forEach(rel => {
   *   console.log(`${rel.sourcePath} references via ${rel.propertyName ?? 'body link'}`);
   * });
   * ```
   */
  getAssetRelations(path: string): AssetRelation[] {
    const relations: AssetRelation[] = [];
    const file = this.plugin.app.vault.getAbstractFileByPath(path);

    if (!(file instanceof TFile)) {
      return relations;
    }

    const backlinks = this.backlinksCacheManager.getBacklinks(path);
    if (!backlinks) {
      return relations;
    }

    for (const sourcePath of backlinks) {
      const sourceFile = this.plugin.app.vault.getAbstractFileByPath(sourcePath);
      if (!sourceFile || !sourcePath.endsWith(".md")) {
        continue;
      }

      const sourceMetadata = this.getAssetMetadata(sourcePath);
      if (!sourceMetadata) {
        continue;
      }

      const sourceFrontmatter = this.plugin.app.metadataCache.getFileCache(
        sourceFile as TFile
      )?.frontmatter || {};

      const referencingProperties = MetadataHelpers.findAllReferencingProperties(
        sourceFrontmatter,
        file.basename
      );

      if (referencingProperties.length > 0) {
        for (const propertyName of referencingProperties) {
          relations.push({
            sourcePath,
            targetPath: path,
            propertyName,
            isBodyLink: false,
            sourceLabel: sourceMetadata.label,
            sourceMetadata,
          });
        }
      } else {
        relations.push({
          sourcePath,
          targetPath: path,
          propertyName: undefined,
          isBodyLink: true,
          sourceLabel: sourceMetadata.label,
          sourceMetadata,
        });
      }
    }

    return relations;
  }

  /**
   * Gets all assets that are linked from the specified asset.
   *
   * @param path - File path relative to vault root
   * @returns Array of linked asset paths
   *
   * @example
   * ```typescript
   * const linked = api.getLinkedAssets('daily-note.md');
   * linked.forEach(linkedPath => {
   *   const label = api.getAssetLabel(linkedPath);
   *   console.log(`Links to: ${label ?? linkedPath}`);
   * });
   * ```
   */
  getLinkedAssets(path: string): string[] {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return [];
    }

    const cache = this.plugin.app.metadataCache.getFileCache(file);
    if (!cache) {
      return [];
    }

    const linkedPaths: Set<string> = new Set();

    // Check frontmatter links
    if (cache.frontmatter) {
      this.extractLinksFromFrontmatter(cache.frontmatter, linkedPaths);
    }

    // Check body links
    if (cache.links) {
      for (const link of cache.links) {
        const resolvedFile = this.plugin.app.metadataCache.getFirstLinkpathDest(
          link.link,
          path
        );
        if (resolvedFile instanceof TFile) {
          linkedPaths.add(resolvedFile.path);
        }
      }
    }

    return Array.from(linkedPaths);
  }

  /**
   * Queries assets matching the specified filter criteria.
   *
   * @param filter - Filter criteria for querying assets
   * @returns Array of matching asset metadata
   *
   * @example
   * ```typescript
   * // Get all active tasks
   * const tasks = api.queryAssets({
   *   class: 'ems__Task',
   *   status: 'DOING'
   * });
   *
   * // Get all projects in a specific area
   * const projects = api.queryAssets({
   *   class: 'ems__Project',
   *   custom: (metadata) => metadata['ems__Effort_area'] === '[[Work]]'
   * });
   * ```
   */
  queryAssets(filter: AssetFilter): AssetMetadata[] {
    const results: AssetMetadata[] = [];
    const files = this.plugin.app.vault.getMarkdownFiles();

    for (const file of files) {
      const metadata = this.getAssetMetadata(file.path);
      if (!metadata) {
        continue;
      }

      if (this.matchesFilter(metadata, filter)) {
        results.push(metadata);
      }
    }

    return results;
  }

  /**
   * Subscribes to an event.
   *
   * @param event - Event type to subscribe to
   * @param callback - Callback function to invoke when event fires
   *
   * @example
   * ```typescript
   * api.on('label-changed', (path, oldLabel, newLabel) => {
   *   console.log(`${path}: ${oldLabel} → ${newLabel}`);
   * });
   *
   * api.on('metadata-changed', (path, metadata) => {
   *   console.log(`Metadata changed for ${path}`);
   * });
   * ```
   */
  on(event: 'label-changed', callback: LabelChangedCallback): void;
  on(event: 'metadata-changed', callback: MetadataChangedCallback): void;
  on(event: ExocortexEventType, callback: LabelChangedCallback | MetadataChangedCallback): void {
    if (event === 'label-changed') {
      this.labelChangedCallbacks.add(callback as LabelChangedCallback);
    } else if (event === 'metadata-changed') {
      this.metadataChangedCallbacks.add(callback as MetadataChangedCallback);
    }
  }

  /**
   * Unsubscribes from an event.
   *
   * @param event - Event type to unsubscribe from
   * @param callback - Callback function to remove
   *
   * @example
   * ```typescript
   * const handler = (path, oldLabel, newLabel) => { ... };
   * api.on('label-changed', handler);
   * // Later:
   * api.off('label-changed', handler);
   * ```
   */
  off(event: 'label-changed', callback: LabelChangedCallback): void;
  off(event: 'metadata-changed', callback: MetadataChangedCallback): void;
  off(event: ExocortexEventType, callback: LabelChangedCallback | MetadataChangedCallback): void {
    if (event === 'label-changed') {
      this.labelChangedCallbacks.delete(callback as LabelChangedCallback);
    } else if (event === 'metadata-changed') {
      this.metadataChangedCallbacks.delete(callback as MetadataChangedCallback);
    }
  }

  /**
   * Cleans up resources when the API is disposed.
   * Called automatically when the plugin unloads.
   */
  cleanup(): void {
    if (this.metadataEventRef) {
      this.plugin.app.metadataCache.offref(this.metadataEventRef);
      this.metadataEventRef = null;
    }

    this.labelChangedCallbacks.clear();
    this.metadataChangedCallbacks.clear();
    this.previousLabels.clear();

    this.logger.info("ExocortexAPI cleaned up");
  }

  // ========================
  // Private Helper Methods
  // ========================

  private setupMetadataListener(): void {
    this.metadataEventRef = this.plugin.app.metadataCache.on('changed', (file) => {
      if (!(file instanceof TFile)) {
        return;
      }

      const path = file.path;
      const metadata = this.getAssetMetadata(path);

      if (!metadata) {
        return;
      }

      // Check for label changes
      const previousLabel = this.previousLabels.get(path);
      const currentLabel = metadata.label;

      if (previousLabel !== currentLabel) {
        this.previousLabels.set(path, currentLabel);

        // Only emit if we had a previous value (not first load)
        if (this.previousLabels.has(path)) {
          this.emitLabelChanged(path, previousLabel ?? null, currentLabel);
        }
      }

      // Always emit metadata changed
      this.emitMetadataChanged(path, metadata);
    });
  }

  private emitLabelChanged(path: string, oldLabel: string | null, newLabel: string | null): void {
    for (const callback of this.labelChangedCallbacks) {
      try {
        callback(path, oldLabel, newLabel);
      } catch (error) {
        this.logger.error(
          `Error in label-changed callback for ${path}`,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  }

  private emitMetadataChanged(path: string, metadata: AssetMetadata): void {
    for (const callback of this.metadataChangedCallbacks) {
      try {
        callback(path, metadata);
      } catch (error) {
        this.logger.error(
          `Error in metadata-changed callback for ${path}`,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  }

  private extractInstanceClass(frontmatter: Record<string, unknown>): string | null {
    const instanceClass = frontmatter.exo__Instance_class;
    if (!instanceClass) {
      return null;
    }

    if (Array.isArray(instanceClass)) {
      const first = instanceClass[0];
      return typeof first === 'string' ? first.replace(/^\[\[|\]\]$/g, '').trim() : null;
    }

    return typeof instanceClass === 'string'
      ? instanceClass.replace(/^\[\[|\]\]$/g, '').trim()
      : null;
  }

  private extractStatus(frontmatter: Record<string, unknown>): string | null {
    const status = frontmatter.ems__Effort_status;
    if (!status) {
      return null;
    }

    if (Array.isArray(status)) {
      const first = status[0];
      return typeof first === 'string' ? first : null;
    }

    return typeof status === 'string' ? status : null;
  }

  private extractPrototype(frontmatter: Record<string, unknown>): string | null {
    const prototype = frontmatter.exo__Asset_prototype;
    if (!prototype || typeof prototype !== 'string') {
      return null;
    }

    return prototype.replace(/^\[\[|\]\]$/g, '').trim();
  }

  private extractLinksFromFrontmatter(
    frontmatter: Record<string, unknown>,
    linkedPaths: Set<string>
  ): void {
    for (const value of Object.values(frontmatter)) {
      this.extractLinksFromValue(value, linkedPaths);
    }
  }

  private extractLinksFromValue(value: unknown, linkedPaths: Set<string>): void {
    if (typeof value === 'string') {
      const wikiLinkMatch = value.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
      if (wikiLinkMatch) {
        const linkPath = wikiLinkMatch[1];
        const resolvedFile = this.plugin.app.metadataCache.getFirstLinkpathDest(linkPath, '');
        if (resolvedFile instanceof TFile) {
          linkedPaths.add(resolvedFile.path);
        }
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        this.extractLinksFromValue(item, linkedPaths);
      }
    }
  }

  private matchesFilter(metadata: AssetMetadata, filter: AssetFilter): boolean {
    if (filter.class !== undefined && metadata.class !== filter.class) {
      return false;
    }

    if (filter.status !== undefined && metadata.status !== filter.status) {
      return false;
    }

    if (filter.isArchived !== undefined && metadata.isArchived !== filter.isArchived) {
      return false;
    }

    if (filter.isBlocked !== undefined && metadata.isBlocked !== filter.isBlocked) {
      return false;
    }

    if (filter.hasLabel !== undefined) {
      const hasLabel = metadata.label !== null && metadata.label.trim() !== '';
      if (hasLabel !== filter.hasLabel) {
        return false;
      }
    }

    if (filter.custom && !filter.custom(metadata)) {
      return false;
    }

    return true;
  }
}

/**
 * Filter criteria for querying assets.
 */
export interface AssetFilter {
  /** Filter by instance class */
  class?: string;
  /** Filter by status */
  status?: string;
  /** Filter by archived state */
  isArchived?: boolean;
  /** Filter by blocked state */
  isBlocked?: boolean;
  /** Filter by whether asset has a label */
  hasLabel?: boolean;
  /** Custom filter function */
  custom?: (metadata: AssetMetadata) => boolean;
}

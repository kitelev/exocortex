import { TFile, Keymap } from "obsidian";
import React from "react";
import { ReactRenderer } from '@plugin/presentation/utils/ReactRenderer';
import { MetadataHelpers, IVaultAdapter, IFile, type ILogger } from "exocortex";
import { AssetRelationsTableWithToggle } from '@plugin/presentation/components/AssetRelationsTable';
import { BacklinksCacheManager } from '@plugin/adapters/caching/BacklinksCacheManager';
import { ExocortexSettings } from '@plugin/domain/settings/ExocortexSettings';
import { AssetMetadataService } from "./helpers/AssetMetadataService";
import { AssetRelation } from "./types";
import { BlockerHelpers } from '@plugin/presentation/utils/BlockerHelpers';
import { ObsidianApp, ExocortexPluginInterface } from '@plugin/types';
import type { LayoutBlockService } from '@plugin/application/layout-blocks';
import { LAYOUT_BLOCK_URIS } from '@plugin/domain/layout-blocks';
import { LoggerFactory } from '@plugin/adapters/logging/LoggerFactory';

export interface UniversalLayoutConfig {
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  showProperties?: string[];
  /**
   * Whether to use RDF-driven SPARQL queries for relations.
   * When true and LayoutBlockService is available, relations are loaded from RDF.
   * Falls back to hardcoded logic when false or service unavailable.
   * @default false
   */
  useRdfQueries?: boolean;
}

/**
 * RelationsRenderer - Renders asset relations with RDF-driven architecture support
 *
 * This renderer supports two modes:
 * 1. **Legacy mode** (default): Uses BacklinksCacheManager and MetadataHelpers
 * 2. **RDF mode**: Uses SPARQL queries from RDF layout block definitions
 *
 * RDF mode is enabled when:
 * - config.useRdfQueries is true
 * - LayoutBlockService is provided via setLayoutBlockService()
 * - The InboundRelationsBlock exists in RDF with a valid query
 *
 * @example
 * ```typescript
 * // Enable RDF mode
 * renderer.setLayoutBlockService(layoutBlockService);
 * const relations = await renderer.getAssetRelations(file, { useRdfQueries: true });
 * ```
 */
export class RelationsRenderer {
  private layoutBlockService: LayoutBlockService | null = null;
  private readonly logger: ILogger;

  constructor(
    private app: ObsidianApp,
    private settings: ExocortexSettings,
    private reactRenderer: ReactRenderer,
    private backlinksCacheManager: BacklinksCacheManager,
    private metadataService: AssetMetadataService,
    private plugin: ExocortexPluginInterface,
    private refresh: () => Promise<void>,
    private vaultAdapter: IVaultAdapter,
  ) {
    const defaultLogger = LoggerFactory.create("RelationsRenderer");
    this.logger = {
      debug: defaultLogger.debug.bind(defaultLogger),
      info: defaultLogger.info.bind(defaultLogger),
      warn: defaultLogger.warn.bind(defaultLogger),
      error: defaultLogger.error.bind(defaultLogger),
    };
  }

  /**
   * Set the LayoutBlockService for RDF-driven query execution.
   * When set, enables the use of SPARQL queries from RDF layout blocks.
   *
   * @param service - The LayoutBlockService instance
   */
  setLayoutBlockService(service: LayoutBlockService): void {
    this.layoutBlockService = service;
    this.logger.info("LayoutBlockService configured for RDF-driven relations");
  }

  /**
   * Get asset relations for a file.
   *
   * When RDF mode is enabled (config.useRdfQueries=true and LayoutBlockService available),
   * executes SPARQL query from InboundRelationsBlock. Otherwise falls back to legacy mode.
   *
   * @param file - The file to get relations for
   * @param config - Configuration options
   * @returns Array of asset relations
   */
  async getAssetRelations(
    file: TFile,
    config: UniversalLayoutConfig,
  ): Promise<AssetRelation[]> {
    // Try RDF mode if enabled
    if (config.useRdfQueries && this.layoutBlockService) {
      const rdfRelations = await this.getAssetRelationsFromRdf(file, config);
      if (rdfRelations !== null) {
        return rdfRelations;
      }
      // Fall through to legacy mode if RDF failed
      this.logger.debug("RDF query failed or returned no results, falling back to legacy mode");
    }

    // Legacy mode: use BacklinksCacheManager
    return this.getAssetRelationsLegacy(file, config);
  }

  /**
   * Get asset relations using RDF-driven SPARQL query.
   *
   * @param file - The file to get relations for
   * @param config - Configuration options
   * @returns Array of asset relations, or null if RDF query fails
   */
  private async getAssetRelationsFromRdf(
    file: TFile,
    config: UniversalLayoutConfig,
  ): Promise<AssetRelation[] | null> {
    if (!this.layoutBlockService) {
      return null;
    }

    try {
      // Get the InboundRelationsBlock
      const inboundBlock = await this.layoutBlockService.getBlock(
        LAYOUT_BLOCK_URIS.INBOUND_RELATIONS
      );

      if (!inboundBlock || !inboundBlock.query) {
        this.logger.debug("InboundRelationsBlock not found or has no query, using legacy mode");
        return null;
      }

      // Construct asset URI from file path
      const assetUri = `obsidian://vault/${encodeURIComponent(file.path)}`;

      // Execute the block's SPARQL query
      const queryResult = await this.layoutBlockService.executeBlockQuery(
        inboundBlock,
        assetUri
      );

      if (queryResult.bindings.length === 0) {
        return [];
      }

      // Convert SPARQL bindings to AssetRelation objects
      const relations: AssetRelation[] = [];

      for (const binding of queryResult.bindings) {
        const relation = this.bindingToAssetRelation(binding, file);
        if (relation) {
          relations.push(relation);
        }
      }

      // Apply sorting if configured
      if (config.sortBy) {
        this.sortRelations(relations, config.sortBy, config.sortOrder);
      }

      this.logger.debug(`Loaded ${relations.length} relations from RDF for ${file.path}`);
      return relations;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error loading relations from RDF: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Get asset relations using legacy BacklinksCacheManager approach.
   *
   * @param file - The file to get relations for
   * @param config - Configuration options
   * @returns Array of asset relations
   */
  private async getAssetRelationsLegacy(
    file: TFile,
    config: UniversalLayoutConfig,
  ): Promise<AssetRelation[]> {
    const relations: AssetRelation[] = [];

    const backlinks = this.backlinksCacheManager.getBacklinks(file.path);
    if (!backlinks) {
      return relations;
    }

    for (const sourcePath of backlinks) {
      const sourceFile = this.vaultAdapter.getAbstractFileByPath(sourcePath);
      if (sourceFile && sourcePath.endsWith(".md")) {
        const iFile = sourceFile as IFile;
        const metadata = this.vaultAdapter.getFrontmatter(iFile) || {};

        const isArchived = MetadataHelpers.isAssetArchived(metadata);

        const referencingProperties =
          MetadataHelpers.findAllReferencingProperties(metadata, file.basename);

        const enrichedMetadata = { ...metadata };
        const resolvedLabel = this.metadataService.getAssetLabel(sourcePath);
        if (resolvedLabel) {
          enrichedMetadata.exo__Asset_label = resolvedLabel;
        }

        const isBlocked = BlockerHelpers.isEffortBlocked(this.app, metadata);

        if (referencingProperties.length > 0) {
          for (const propertyName of referencingProperties) {
            const displayLabel = enrichedMetadata.exo__Asset_label || iFile.basename;
            const relation: AssetRelation = {
              file: { path: sourcePath, basename: iFile.basename },
              path: sourcePath,
              title: displayLabel,
              metadata: enrichedMetadata,
              propertyName: propertyName,
              isBodyLink: false,
              isArchived: isArchived,
              isBlocked: isBlocked,
              created: iFile.stat?.ctime || 0,
              modified: iFile.stat?.mtime || 0,
            };
            relations.push(relation);
          }
        } else {
          const displayLabel = enrichedMetadata.exo__Asset_label || iFile.basename;
          const relation: AssetRelation = {
            file: { path: sourcePath, basename: iFile.basename },
            path: sourcePath,
            title: displayLabel,
            metadata: enrichedMetadata,
            propertyName: undefined,
            isBodyLink: true,
            isArchived: isArchived,
            isBlocked: isBlocked,
            created: iFile.stat?.ctime || 0,
            modified: iFile.stat?.mtime || 0,
          };
          relations.push(relation);
        }
      }
    }

    if (config.sortBy) {
      this.sortRelations(relations, config.sortBy, config.sortOrder);
    }

    return relations;
  }

  /**
   * Convert an RDF query binding to an AssetRelation.
   *
   * Expected binding variables from SPARQL query:
   * - ?source: Path or URI of the source asset
   * - ?predicate: The property name linking source to target
   * - ?label: Optional label for the source asset
   * - ?isArchived: Optional archived status
   * - ?created: Optional creation timestamp
   * - ?modified: Optional modification timestamp
   *
   * @param binding - The SPARQL result binding
   * @param _targetFile - The target file being queried (reserved for future use)
   * @returns AssetRelation or null if binding is invalid
   */
  private bindingToAssetRelation(
    binding: Record<string, unknown>,
    _targetFile: TFile,
  ): AssetRelation | null {
    const source = binding.source as string | undefined;
    if (!source) {
      return null;
    }

    // Extract path from URI if needed (handle obsidian:// URIs)
    let sourcePath = source;
    if (source.startsWith("obsidian://vault/")) {
      sourcePath = decodeURIComponent(source.replace("obsidian://vault/", ""));
    }

    // Get the source file for additional metadata
    const sourceFile = this.vaultAdapter.getAbstractFileByPath(sourcePath);
    if (!sourceFile) {
      return null;
    }

    const iFile = sourceFile as IFile;
    const metadata = this.vaultAdapter.getFrontmatter(iFile) || {};

    // Use binding values or fall back to metadata/file info
    const label = (binding.label as string) ||
                  metadata.exo__Asset_label as string ||
                  iFile.basename;
    const predicate = binding.predicate as string | undefined;
    const isArchived = binding.isArchived === "true" ||
                       MetadataHelpers.isAssetArchived(metadata);
    const isBlocked = BlockerHelpers.isEffortBlocked(this.app, metadata);

    // Parse timestamps from binding or use file stats
    const created = binding.created ?
      new Date(binding.created as string).getTime() :
      (iFile.stat?.ctime || 0);
    const modified = binding.modified ?
      new Date(binding.modified as string).getTime() :
      (iFile.stat?.mtime || 0);

    return {
      file: { path: sourcePath, basename: iFile.basename },
      path: sourcePath,
      title: label,
      metadata: { ...metadata, exo__Asset_label: label },
      propertyName: predicate,
      isBodyLink: !predicate,
      isArchived,
      isBlocked,
      created,
      modified,
    };
  }

  /**
   * Sort relations by a property.
   *
   * @param relations - Relations to sort (mutated in place)
   * @param sortBy - Property to sort by
   * @param sortOrder - Sort order
   */
  private sortRelations(
    relations: AssetRelation[],
    sortBy: string,
    sortOrder?: "asc" | "desc",
  ): void {
    relations.sort((a, b) => {
      const aVal = MetadataHelpers.getPropertyValue(a, sortBy);
      const bVal = MetadataHelpers.getPropertyValue(b, sortBy);
      const order = sortOrder === "desc" ? -1 : 1;
      return aVal > bVal ? order : -order;
    });
  }

  async render(
    el: HTMLElement,
    relations: AssetRelation[],
    config: UniversalLayoutConfig,
    renderHeader?: (container: HTMLElement, sectionId: string, title: string) => void,
    isCollapsed?: boolean,
  ): Promise<void> {
    if (relations.length === 0) {
      return;
    }

    const container = el.createDiv({ cls: "exocortex-assets-relations" });

    // Render collapsible header if function provided
    if (renderHeader) {
      renderHeader(container, "relations", "Asset Relations");
    }

    // Create content container
    const contentContainer = container.createDiv({
      cls: "exocortex-section-content",
      attr: {
        "data-collapsed": (isCollapsed || false).toString(),
      },
    });

    // Only render content if not collapsed
    if (isCollapsed) {
      return;
    }

    this.reactRenderer.render(
      contentContainer,
      React.createElement(AssetRelationsTableWithToggle, {
        relations,
        groupByProperty: true,
        sortBy: config.sortBy || "title",
        sortOrder: config.sortOrder || "asc",
        showProperties: config.showProperties || [],
        groupSpecificProperties: {
          ems__Effort_parent: ["ems__Effort_status"],
          ems__Effort_area: ["ems__Effort_status"],
        },
        showEffortVotes: this.settings.showEffortVotes,
        onToggleEffortVotes: async () => {
          this.settings.showEffortVotes = !this.settings.showEffortVotes;
          await this.plugin.saveSettings();
          await this.refresh();
        },
        showArchived: this.settings.showArchivedAssets,
        onToggleArchived: async () => {
          this.settings.showArchivedAssets = !this.settings.showArchivedAssets;
          await this.plugin.saveSettings();
          await this.refresh();
        },
        onAssetClick: async (path: string, event: React.MouseEvent) => {
          const isModPressed = Keymap.isModEvent(
            event.nativeEvent as MouseEvent,
          );

          if (isModPressed) {
            await this.app.workspace.openLinkText(path, "", "tab");
          } else {
            await this.app.workspace.openLinkText(path, "", false);
          }
        },
        getAssetLabel: (path: string) => this.metadataService.getAssetLabel(path),
      }),
    );
  }
}

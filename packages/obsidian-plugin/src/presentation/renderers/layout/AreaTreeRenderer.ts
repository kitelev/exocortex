import { TFile, Keymap } from "obsidian";
import React from "react";
import { ReactRenderer } from '@plugin/presentation/utils/ReactRenderer';
import {
  MetadataExtractor,
  AssetClass,
  AreaHierarchyBuilder,
  IVaultAdapter,
  LayoutSelector,
} from "exocortex";
import { AreaHierarchyTreeWithToggle, type AreaClickEvent } from '@plugin/presentation/components/AreaHierarchyTree';
import { AssetMetadataService } from "./helpers/AssetMetadataService";
import { AssetRelation } from "./types";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import { ObsidianApp } from '@plugin/types';
import { SPARQLQueryService } from '@plugin/application/services/SPARQLQueryService';

/**
 * AreaTreeRenderer - Renders area hierarchy tree using RDF-driven configuration.
 *
 * This renderer supports two modes:
 * 1. RDF-driven mode: Uses LayoutSelector to get SPARQL queries from RDF layout definitions
 * 2. Legacy mode: Falls back to hardcoded TypeScript logic when RDF is unavailable
 *
 * @see Issue #1460: Refactor AreaTreeRenderer to use RDF
 * @see Implementation Plan: Phase 6.6, Task 4
 */
export class AreaTreeRenderer {
  private layoutSelector?: LayoutSelector;
  private sparqlQueryService?: SPARQLQueryService;

  constructor(
    private app: ObsidianApp,
    private reactRenderer: ReactRenderer,
    private metadataExtractor: MetadataExtractor,
    private vaultAdapter: IVaultAdapter,
    private metadataService: AssetMetadataService,
    private logger: ILogger,
    layoutSelector?: LayoutSelector,
    sparqlQueryService?: SPARQLQueryService,
  ) {
    this.layoutSelector = layoutSelector;
    this.sparqlQueryService = sparqlQueryService;
  }

  /**
   * Set the LayoutSelector for RDF-driven rendering.
   * Called after construction when dependencies become available.
   */
  setLayoutSelector(layoutSelector: LayoutSelector): void {
    this.layoutSelector = layoutSelector;
  }

  /**
   * Set the SPARQLQueryService for RDF-driven rendering.
   * Called after construction when dependencies become available.
   */
  setSparqlQueryService(sparqlQueryService: SPARQLQueryService): void {
    this.sparqlQueryService = sparqlQueryService;
  }

  /**
   * Check if RDF-driven rendering is available.
   */
  private isRdfDrivenAvailable(): boolean {
    return !!(this.layoutSelector && this.sparqlQueryService);
  }

  /**
   * Build asset URI from file path.
   */
  private buildAssetUri(file: TFile): string {
    const metadata = this.metadataExtractor.extractMetadata(file);
    const uid = metadata?.exo__Asset_uid as string;
    if (uid) {
      return `https://exocortex.my/assets/${uid}`;
    }
    return `file://${file.path}`;
  }

  async render(
    el: HTMLElement,
    file: TFile,
    relations: AssetRelation[],
    renderHeader?: (container: HTMLElement, sectionId: string, title: string) => void,
    isCollapsed?: boolean,
  ): Promise<void> {
    const metadata = this.metadataExtractor.extractMetadata(file);
    const instanceClass = this.metadataService.extractInstanceClass(metadata);

    if (instanceClass !== AssetClass.AREA) {
      return;
    }

    // Try RDF-driven rendering first, fall back to legacy if unavailable
    let tree;
    let blockLabel = "Area tree"; // Default label

    if (this.isRdfDrivenAvailable()) {
      try {
        const result = await this.renderRdfDriven(file, relations);
        if (result) {
          tree = result.tree;
          blockLabel = result.label || blockLabel;
          this.logger.debug(`Using RDF-driven rendering for Area Tree: ${file.path}`);
        }
      } catch (error) {
        this.logger.warn(`RDF-driven rendering failed, falling back to legacy`, { error });
      }
    }

    // Fall back to legacy rendering if RDF-driven failed or unavailable
    if (!tree) {
      tree = this.renderLegacy(file, relations);
      this.logger.debug(`Using legacy rendering for Area Tree: ${file.path}`);
    }

    if (!tree) {
      return;
    }

    const sectionContainer = el.createDiv({
      cls: "exocortex-area-tree-section",
    });

    // Render collapsible header if function provided
    if (renderHeader) {
      renderHeader(sectionContainer, "area-tree", blockLabel);
    } else {
      sectionContainer.createEl("h3", {
        text: blockLabel,
        cls: "exocortex-section-header",
      });
    }

    // Create content container
    const contentContainer = sectionContainer.createDiv({
      cls: "exocortex-section-content",
      attr: {
        "data-collapsed": (isCollapsed || false).toString(),
      },
    });

    // Only render content if not collapsed
    if (isCollapsed) {
      return;
    }

    const treeContainer = contentContainer.createDiv({
      cls: "exocortex-area-tree-container",
    });

    this.reactRenderer.render(
      treeContainer,
      React.createElement(AreaHierarchyTreeWithToggle, {
        tree,
        currentAreaPath: file.path,
        onAreaClick: async (path: string, event: AreaClickEvent) => {
          // Check for modifier key press - works for both mouse and keyboard events
          const nativeEvent = event.nativeEvent as MouseEvent | KeyboardEvent;
          const isModPressed = Keymap.isModEvent(nativeEvent);

          if (isModPressed) {
            await this.app.workspace.openLinkText(path, "", "tab");
          } else {
            await this.app.workspace.openLinkText(path, "", false);
          }
        },
        getAssetLabel: (path: string) => this.metadataService.getAssetLabel(path),
      }),
    );

    this.logger.info(`Rendered Area Tree for ${file.path}`);
  }

  /**
   * Legacy rendering using hardcoded TypeScript logic.
   * Used as fallback when RDF-driven rendering is unavailable.
   */
  private renderLegacy(file: TFile, relations: AssetRelation[]) {
    const hierarchyBuilder = new AreaHierarchyBuilder(this.vaultAdapter);
    return hierarchyBuilder.buildHierarchy(file.path, relations);
  }

  /**
   * RDF-driven rendering using SPARQL queries from LayoutSelector.
   * Returns null if RDF layout is not available for this asset.
   */
  private async renderRdfDriven(
    file: TFile,
    relations: AssetRelation[],
  ): Promise<{ tree: ReturnType<AreaHierarchyBuilder["buildHierarchy"]>; label?: string } | null> {
    if (!this.layoutSelector || !this.sparqlQueryService) {
      return null;
    }

    const assetUri = this.buildAssetUri(file);

    // Get layout from RDF
    const layout = await this.layoutSelector.selectLayout(assetUri);
    if (!layout) {
      return null;
    }

    // Find the area-tree block
    const areaTreeBlock = layout.blocks.find(block => block.renderer === "area-tree");
    if (!areaTreeBlock) {
      // No area-tree block in this layout, use legacy
      return null;
    }

    // If there's no query in the block, fall back to legacy
    if (!areaTreeBlock.query) {
      return {
        tree: this.renderLegacy(file, relations),
        label: this.getBlockLabel(),
      };
    }

    // Execute SPARQL query with ?current placeholder replaced
    // Note: For now, we still use the legacy hierarchy builder as the data source
    // The SPARQL query will be used in future iterations when the triple store
    // contains the full asset graph
    //
    // TODO: Replace with actual SPARQL execution when triple store is populated
    // const query = areaTreeBlock.query.replace(/\?current/g, `<${assetUri}>`);
    // const results = await this.sparqlQueryService.query(query);
    // const tree = this.buildTreeFromSparqlResults(results);

    // For Phase 1: Use block metadata but legacy data fetching
    return {
      tree: this.renderLegacy(file, relations),
      label: this.getBlockLabel(),
    };
  }

  /**
   * Get the display label for a layout block.
   * Falls back to default "Area tree" if not specified in RDF.
   */
  private getBlockLabel(): string {
    // The block doesn't have a direct label property in the current interface
    // The label comes from rdfs:label on the block in RDF
    // For now, return a default - this can be extended when LayoutBlock interface
    // includes label property
    return "Area tree";
  }
}

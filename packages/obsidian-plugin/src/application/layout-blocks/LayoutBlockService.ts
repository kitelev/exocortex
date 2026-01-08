/**
 * LayoutBlockService - Loads and executes RDF-driven layout blocks
 *
 * This service bridges RDF layout block definitions with TypeScript execution:
 * 1. Load layout definitions from the RDF triple store
 * 2. Load individual layout blocks with their SPARQL queries
 * 3. Execute block queries with ?asset placeholder substitution
 * 4. Return structured results for rendering
 *
 * The service acts as an adapter between the RDF ontology (exo-ui:LayoutBlock)
 * and the presentation layer (RelationsRenderer, etc.)
 *
 * @module application/layout-blocks
 * @since 1.0.0
 */

import type { App } from "obsidian";
import type { ILogger, INotificationService, SolutionMapping } from "exocortex";
import { Literal, IRI } from "exocortex";

import type {
  LayoutBlock,
  LayoutWithBlocks,
  LayoutBlockQueryResult,
} from "../../domain/layout-blocks";
import { LAYOUT_BLOCK_URIS } from "../../domain/layout-blocks";
import { SPARQLQueryService } from "../services/SPARQLQueryService";
import { LoggerFactory } from "@plugin/adapters/logging/LoggerFactory";

/**
 * Options for LayoutBlockService configuration.
 */
export interface LayoutBlockServiceOptions {
  /**
   * Whether to cache loaded layouts and blocks.
   * @default true
   */
  useCache?: boolean;
}

/**
 * Result of loading relations blocks.
 */
export interface RelationsBlocks {
  /**
   * Inbound relations block (who references this asset)
   */
  inbound: LayoutBlock | null;

  /**
   * Outbound relations block (what this asset references)
   */
  outbound: LayoutBlock | null;
}

/**
 * LayoutBlockService - Orchestrates loading and execution of RDF-driven layout blocks
 *
 * @example
 * ```typescript
 * const service = new LayoutBlockService(app, logger);
 * await service.initialize();
 *
 * // Load a layout with all its blocks
 * const layout = await service.loadLayout('exo-ui:DefaultAssetLayout');
 *
 * // Execute a specific block for an asset
 * for (const block of layout.blocks) {
 *   const result = await service.executeBlockQuery(block, assetUri);
 *   console.log(block.renderer, result.bindings.length);
 * }
 * ```
 */
export class LayoutBlockService {
  private readonly sparqlService: SPARQLQueryService;
  private readonly logger: ILogger;
  private isInitialized = false;

  /**
   * Cache for loaded layouts
   */
  private readonly layoutCache: Map<string, LayoutWithBlocks | null> = new Map();

  /**
   * Cache for loaded blocks
   */
  private readonly blockCache: Map<string, LayoutBlock | null> = new Map();

  constructor(
    app: App,
    logger?: ILogger,
    notifier?: INotificationService
  ) {
    const defaultLogger = LoggerFactory.create("LayoutBlockService");
    this.logger = logger || {
      debug: defaultLogger.debug.bind(defaultLogger),
      info: defaultLogger.info.bind(defaultLogger),
      warn: defaultLogger.warn.bind(defaultLogger),
      error: defaultLogger.error.bind(defaultLogger),
    };

    this.sparqlService = new SPARQLQueryService(app, this.logger, notifier);
  }

  /**
   * Initialize the service.
   * Must be called before any other operations.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    await this.sparqlService.initialize();
    this.isInitialized = true;
    this.logger.info("LayoutBlockService initialized");
  }

  /**
   * Load a layout with all its blocks from RDF.
   *
   * @param layoutUri - URI of the layout to load (e.g., "exo-ui:DefaultAssetLayout")
   * @returns The layout with its blocks, or null if not found
   */
  async loadLayout(layoutUri: string): Promise<LayoutWithBlocks | null> {
    await this.ensureInitialized();

    // Check cache
    if (this.layoutCache.has(layoutUri)) {
      return this.layoutCache.get(layoutUri) ?? null;
    }

    try {
      // Query for layout label
      const labelQuery = `
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        SELECT ?label WHERE {
          <${layoutUri}> rdfs:label ?label .
        }
      `;
      const labelResults = await this.sparqlService.query(labelQuery);

      if (labelResults.length === 0) {
        this.layoutCache.set(layoutUri, null);
        return null;
      }

      const label = this.extractStringValue(labelResults[0].get("label"));

      // Query for blocks in this layout
      const blocksQuery = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        PREFIX exo-ui: <https://exocortex.my/ontology/exo-ui#>

        SELECT ?block ?label ?query ?renderer ?order ?headless WHERE {
          <${layoutUri}> exo-ui:Layout_blocks ?block .
          ?block rdfs:label ?label .
          OPTIONAL { ?block exo-ui:LayoutBlock_query ?query }
          OPTIONAL { ?block exo-ui:LayoutBlock_renderer ?renderer }
          OPTIONAL { ?block exo-ui:LayoutBlock_order ?order }
          OPTIONAL { ?block exo-ui:LayoutBlock_headless ?headless }
        }
        ORDER BY ?order
      `;
      const blocksResults = await this.sparqlService.query(blocksQuery);

      const blocks = blocksResults.map(binding => this.bindingToLayoutBlock(binding));

      // Sort by order
      blocks.sort((a, b) => a.order - b.order);

      const layout: LayoutWithBlocks = {
        layoutUri,
        label,
        blocks,
      };

      this.layoutCache.set(layoutUri, layout);
      return layout;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to load layout ${layoutUri}: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Load a single layout block by URI.
   *
   * @param blockUri - URI of the block to load
   * @returns The block, or null if not found
   */
  async getBlock(blockUri: string): Promise<LayoutBlock | null> {
    await this.ensureInitialized();

    // Check cache
    if (this.blockCache.has(blockUri)) {
      return this.blockCache.get(blockUri) ?? null;
    }

    try {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        PREFIX exo-ui: <https://exocortex.my/ontology/exo-ui#>

        SELECT ?label ?query ?renderer ?order ?headless WHERE {
          <${blockUri}> rdfs:label ?label .
          OPTIONAL { <${blockUri}> exo-ui:LayoutBlock_query ?query }
          OPTIONAL { <${blockUri}> exo-ui:LayoutBlock_renderer ?renderer }
          OPTIONAL { <${blockUri}> exo-ui:LayoutBlock_order ?order }
          OPTIONAL { <${blockUri}> exo-ui:LayoutBlock_headless ?headless }
        }
      `;
      const results = await this.sparqlService.query(query);

      if (results.length === 0) {
        this.blockCache.set(blockUri, null);
        return null;
      }

      const block = this.bindingToLayoutBlock(results[0], blockUri);
      this.blockCache.set(blockUri, block);
      return block;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to load block ${blockUri}: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Get the inbound and outbound relations blocks.
   *
   * @returns Object with inbound and outbound blocks (may be null if not found)
   */
  async getRelationsBlocks(): Promise<RelationsBlocks> {
    const [inbound, outbound] = await Promise.all([
      this.getBlock(LAYOUT_BLOCK_URIS.INBOUND_RELATIONS),
      this.getBlock(LAYOUT_BLOCK_URIS.OUTBOUND_RELATIONS),
    ]);

    return { inbound, outbound };
  }

  /**
   * Execute a layout block's SPARQL query for a specific asset.
   *
   * The ?asset placeholder in the query is replaced with the actual asset URI.
   *
   * @param block - The layout block to execute
   * @param assetUri - URI of the asset to query about
   * @returns Query results as bindings
   */
  async executeBlockQuery(
    block: LayoutBlock,
    assetUri: string
  ): Promise<LayoutBlockQueryResult> {
    await this.ensureInitialized();

    if (!block.query || block.query.trim() === "") {
      return {
        block,
        bindings: [],
      };
    }

    try {
      // Replace ?asset placeholder with actual URI
      const queryWithAsset = block.query.replace(/\?asset/g, `<${assetUri}>`);

      const results = await this.sparqlService.query(queryWithAsset);

      const bindings = results.map(mapping => this.solutionMappingToRecord(mapping));

      return {
        block,
        bindings,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to execute block query for ${block.uri}: ${errorMessage}`);
      return {
        block,
        bindings: [],
      };
    }
  }

  /**
   * Clear all caches.
   */
  clearCache(): void {
    this.layoutCache.clear();
    this.blockCache.clear();
    this.logger.debug("Layout block caches cleared");
  }

  /**
   * Dispose of resources.
   */
  async dispose(): Promise<void> {
    await this.sparqlService.dispose();
    this.clearCache();
    this.isInitialized = false;
    this.logger.info("LayoutBlockService disposed");
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Ensure the service is initialized.
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  /**
   * Convert a SPARQL binding to a LayoutBlock.
   */
  private bindingToLayoutBlock(
    binding: SolutionMapping,
    blockUri?: string
  ): LayoutBlock {
    const blockUriValue = blockUri || this.extractStringValue(binding.get("block"));
    const label = this.extractStringValue(binding.get("label")) || "Unnamed Block";
    const query = this.extractStringValue(binding.get("query")) || "";
    const renderer = this.extractStringValue(binding.get("renderer")) || "text";
    const orderStr = this.extractStringValue(binding.get("order"));
    const order = orderStr ? parseInt(orderStr, 10) : 0;
    const headlessStr = this.extractStringValue(binding.get("headless"));
    const headless = headlessStr !== "false"; // Default to true

    return {
      uri: blockUriValue,
      label,
      query,
      renderer,
      order,
      headless,
    };
  }

  /**
   * Extract string value from an RDF term.
   */
  private extractStringValue(term: unknown): string {
    if (!term) {
      return "";
    }
    if (term instanceof Literal) {
      return term.value;
    }
    if (term instanceof IRI) {
      return term.value;
    }
    if (typeof term === "object" && "value" in term) {
      return String((term as { value: unknown }).value);
    }
    return String(term);
  }

  /**
   * Convert a SolutionMapping to a plain record.
   */
  private solutionMappingToRecord(mapping: SolutionMapping): Record<string, unknown> {
    const record: Record<string, unknown> = {};
    const bindings = mapping.getBindings();
    for (const [key, value] of bindings.entries()) {
      record[key] = this.extractStringValue(value);
    }
    return record;
  }
}

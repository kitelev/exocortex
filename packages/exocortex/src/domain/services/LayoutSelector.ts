/**
 * LayoutSelector - RDF-driven layout selection service
 *
 * Selects the appropriate layout based on an asset's rdf:type classes,
 * choosing class-specific layouts when available and falling back to
 * DefaultAssetLayout otherwise.
 *
 * @see /Users/kitelev/vault-2025/03 Knowledge/concepts/RDF-Driven Architecture Implementation Plan (Note).md
 * Phase 6.6: Layout Selection mechanism (lines 2782-2816)
 *
 * Issue #1459: Implement LayoutSelector service in ActionInterpreter
 * @see https://github.com/kitelev/exocortex/issues/1459
 *
 * Algorithm:
 * 1. Get all classes of asset (rdf:type)
 * 2. For each class, find Layout with Layout_appliesTo = class
 * 3. If found → use class-specific layout
 * 4. If not found → use DefaultAssetLayout
 *
 * Class priority:
 * 1. Most specific (pn:DailyNote)
 * 2. Parent class (ems:Effort)
 * 3. Default (exo:Asset)
 */

import { ITripleStore } from "../../interfaces/ITripleStore";
import { IRI } from "../models/rdf/IRI";
import { BlankNode } from "../models/rdf/BlankNode";
import type { Subject } from "../models/rdf/Triple";

/**
 * Namespace URIs used in layout selection
 */
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";
const EXO_UI_NS = "https://exocortex.my/ontology/exo-ui#";
const EXO_NS = "https://exocortex.my/ontology/exo#";

/**
 * Layout block renderer types
 */
export type LayoutBlockRenderer =
  | "identity"
  | "classification"
  | "relations-table"
  | "backlinks-table"
  | "usage-context"
  | "markdown"
  | string;

/**
 * Layout block definition loaded from RDF
 */
export interface LayoutBlock {
  /**
   * Block URI (e.g., "exo-ui:IdentityBlock")
   */
  uri: string;

  /**
   * SPARQL query template with ?asset placeholder
   */
  query: string;

  /**
   * Renderer component name
   */
  renderer: LayoutBlockRenderer;

  /**
   * Display order in the layout (1-based)
   */
  order: number;

  /**
   * Whether this block can be rendered without UI (CLI-compatible)
   * @default true
   */
  headless: boolean;
}

/**
 * Layout definition with its blocks
 */
export interface Layout {
  /**
   * Layout URI (e.g., "exo-ui:DefaultAssetLayout")
   */
  uri: string;

  /**
   * Human-readable label
   */
  label: string;

  /**
   * Asset classes this layout applies to
   */
  appliesTo: string[];

  /**
   * Ordered list of blocks in this layout
   */
  blocks: LayoutBlock[];
}

/**
 * LayoutSelector - Selects appropriate layout based on asset's rdf:type
 *
 * @example
 * ```typescript
 * const selector = new LayoutSelector(tripleStore);
 *
 * // Select layout for an asset
 * const layout = await selector.selectLayout('https://exocortex.my/assets/task-123');
 * console.log(layout?.uri); // 'exo-ui:TaskLayout' or 'exo-ui:DefaultAssetLayout'
 *
 * // Load specific layout with blocks
 * const defaultLayout = await selector.loadLayout('exo-ui:DefaultAssetLayout');
 * for (const block of defaultLayout.blocks) {
 *   console.log(block.renderer, block.order);
 * }
 * ```
 */
export class LayoutSelector {
  /**
   * Cache for loaded layouts
   */
  private readonly layoutCache: Map<string, Layout | null> = new Map();

  /**
   * Cache for class-to-layout mappings
   */
  private readonly classLayoutCache: Map<string, string | null> = new Map();

  constructor(private readonly tripleStore: ITripleStore) {}

  /**
   * Select the appropriate layout for an asset based on its rdf:type classes.
   *
   * @param assetUri - URI of the asset to find layout for
   * @returns Layout definition, or null if no layout found
   */
  async selectLayout(assetUri: string): Promise<Layout | null> {
    // 1. Get all classes of the asset
    const classes = await this.getAssetClasses(assetUri);

    if (classes.length === 0) {
      // Fallback to DefaultAssetLayout if no classes
      return this.loadLayout(`${EXO_UI_NS}DefaultAssetLayout`);
    }

    // 2. Get all available layouts with their appliesTo classes
    const layoutMappings = await this.getLayoutMappings();

    // 3. Find matching layout by class priority
    // Classes are assumed to be ordered by specificity (most specific first)
    for (const classUri of classes) {
      const layoutUri = layoutMappings.get(classUri);
      if (layoutUri) {
        return this.loadLayout(layoutUri);
      }
    }

    // 4. Fallback: Check for DefaultAssetLayout (applies to exo:Asset)
    const defaultLayoutUri = layoutMappings.get(`${EXO_NS}Asset`);
    if (defaultLayoutUri) {
      return this.loadLayout(defaultLayoutUri);
    }

    // Final fallback
    return this.loadLayout(`${EXO_UI_NS}DefaultAssetLayout`);
  }

  /**
   * Load a layout definition with all its blocks.
   *
   * @param layoutUri - URI of the layout to load
   * @returns Layout with blocks, or null if not found
   */
  async loadLayout(layoutUri: string): Promise<Layout | null> {
    // Check cache first
    if (this.layoutCache.has(layoutUri)) {
      return this.layoutCache.get(layoutUri) ?? null;
    }

    try {
      // Get layout label
      const labelTriples = await this.tripleStore.match(
        new IRI(layoutUri),
        new IRI(`${RDFS_NS}label`),
        undefined
      );

      const label = labelTriples.length > 0
        ? this.extractStringValue(labelTriples[0].object)
        : "Unnamed Layout";

      // Get blocks (may be direct references or RDF list)
      const blockTriples = await this.tripleStore.match(
        new IRI(layoutUri),
        new IRI(`${EXO_UI_NS}Layout_blocks`),
        undefined
      );

      const blocks: LayoutBlock[] = [];
      const processedBlockUris = new Set<string>();

      for (const triple of blockTriples) {
        const blockRefValue = this.extractStringValue(triple.object);

        // Check if it's a blank node (RDF list)
        if (blockRefValue.startsWith("_:")) {
          // Traverse RDF list
          const listBlocks = await this.traverseRdfList(blockRefValue);
          for (const blockUri of listBlocks) {
            if (!processedBlockUris.has(blockUri)) {
              processedBlockUris.add(blockUri);
              const block = await this.loadBlock(blockUri);
              if (block) {
                blocks.push(block);
              }
            }
          }
        } else {
          // Direct block reference
          if (!processedBlockUris.has(blockRefValue)) {
            processedBlockUris.add(blockRefValue);
            const block = await this.loadBlock(blockRefValue);
            if (block) {
              blocks.push(block);
            }
          }
        }
      }

      // Sort blocks by order
      blocks.sort((a, b) => a.order - b.order);

      // Get appliesTo classes
      const appliesToTriples = await this.tripleStore.match(
        new IRI(layoutUri),
        new IRI(`${EXO_UI_NS}Layout_appliesTo`),
        undefined
      );

      const appliesTo = appliesToTriples.map(t => this.extractStringValue(t.object));

      const layout: Layout = {
        uri: layoutUri,
        label,
        appliesTo,
        blocks,
      };

      // Cache the result
      this.layoutCache.set(layoutUri, layout);

      return layout;
    } catch {
      // Cache null for failed lookups to avoid repeated failures
      this.layoutCache.set(layoutUri, null);
      return null;
    }
  }

  /**
   * Clear all caches.
   * Call this when RDF data changes.
   */
  clearCache(): void {
    this.layoutCache.clear();
    this.classLayoutCache.clear();
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Get all rdf:type classes for an asset.
   */
  private async getAssetClasses(assetUri: string): Promise<string[]> {
    const triples = await this.tripleStore.match(
      new IRI(assetUri),
      new IRI(RDF_TYPE),
      undefined
    );

    return triples.map(t => this.extractStringValue(t.object));
  }

  /**
   * Get all layout mappings (class URI → layout URI).
   */
  private async getLayoutMappings(): Promise<Map<string, string>> {
    const mappings = new Map<string, string>();

    // Query for all Layout_appliesTo triples
    const triples = await this.tripleStore.match(
      undefined,
      new IRI(`${EXO_UI_NS}Layout_appliesTo`),
      undefined
    );

    for (const triple of triples) {
      const layoutUri = this.extractStringValue(triple.subject);
      const classUri = this.extractStringValue(triple.object);
      mappings.set(classUri, layoutUri);
    }

    return mappings;
  }

  /**
   * Load a single layout block by URI.
   */
  private async loadBlock(blockUri: string): Promise<LayoutBlock | null> {
    try {
      // Get block order
      const orderTriples = await this.tripleStore.match(
        new IRI(blockUri),
        new IRI(`${EXO_UI_NS}LayoutBlock_order`),
        undefined
      );
      const order = orderTriples.length > 0
        ? parseInt(this.extractStringValue(orderTriples[0].object), 10)
        : 0;

      // Get block query
      const queryTriples = await this.tripleStore.match(
        new IRI(blockUri),
        new IRI(`${EXO_UI_NS}LayoutBlock_query`),
        undefined
      );
      const query = queryTriples.length > 0
        ? this.extractStringValue(queryTriples[0].object)
        : "";

      // Get block renderer
      const rendererTriples = await this.tripleStore.match(
        new IRI(blockUri),
        new IRI(`${EXO_UI_NS}LayoutBlock_renderer`),
        undefined
      );
      const renderer = rendererTriples.length > 0
        ? this.extractStringValue(rendererTriples[0].object)
        : "text";

      // Get headless flag
      const headlessTriples = await this.tripleStore.match(
        new IRI(blockUri),
        new IRI(`${EXO_UI_NS}LayoutBlock_headless`),
        undefined
      );
      const headless = headlessTriples.length > 0
        ? this.extractStringValue(headlessTriples[0].object) !== "false"
        : true;

      return {
        uri: blockUri,
        query,
        renderer,
        order,
        headless,
      };
    } catch {
      return null;
    }
  }

  /**
   * Traverse an RDF list and return all element URIs.
   * RDF list structure: head -> rdf:first -> element, rdf:rest -> next node (or rdf:nil)
   */
  private async traverseRdfList(listNodeUri: string): Promise<string[]> {
    const elements: string[] = [];
    let currentNode = listNodeUri;
    const visitedNodes = new Set<string>();

    while (currentNode && currentNode !== `${RDF_NS}nil`) {
      // Prevent infinite loops
      if (visitedNodes.has(currentNode)) {
        break;
      }
      visitedNodes.add(currentNode);

      // Create subject from URI (handles blank nodes)
      const subject = this.createSubject(currentNode);

      // Get rdf:first (the element)
      const firstTriples = await this.tripleStore.match(
        subject,
        new IRI(`${RDF_NS}first`),
        undefined
      );

      if (firstTriples.length > 0) {
        const elementUri = this.extractStringValue(firstTriples[0].object);
        elements.push(elementUri);
      }

      // Get rdf:rest (next node)
      const restTriples = await this.tripleStore.match(
        subject,
        new IRI(`${RDF_NS}rest`),
        undefined
      );

      if (restTriples.length > 0) {
        currentNode = this.extractStringValue(restTriples[0].object);
      } else {
        break;
      }
    }

    return elements;
  }

  /**
   * Extract string value from an RDF term.
   */
  private extractStringValue(term: unknown): string {
    if (!term) {
      return "";
    }
    if (typeof term === "object" && "value" in term) {
      return String((term as { value: unknown }).value);
    }
    // Handle BlankNode specially - return the full _:id format
    if (term instanceof BlankNode) {
      return term.toString();
    }
    return String(term);
  }

  /**
   * Create an RDF subject (IRI or BlankNode) from a URI string.
   * Handles blank node notation (_:id).
   */
  private createSubject(uri: string): Subject {
    if (uri.startsWith("_:")) {
      // Remove _: prefix for BlankNode constructor
      return new BlankNode(uri.substring(2));
    }
    return new IRI(uri);
  }
}

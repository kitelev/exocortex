/**
 * LayoutBlock - Domain model for RDF-driven layout blocks
 *
 * Represents a reusable UI block that can be rendered as part of an asset layout.
 * Each block has a SPARQL query that retrieves data about an asset, and a renderer
 * that determines how to display that data.
 *
 * Maps to ontology class: exo-ui:LayoutBlock
 *
 * Properties from ontology:
 * - exo-ui:LayoutBlock_query: SPARQL query template with ?asset placeholder
 * - exo-ui:LayoutBlock_renderer: Component name to render this block
 * - exo-ui:LayoutBlock_order: Display order in the layout
 * - exo-ui:LayoutBlock_headless: Whether this block can be rendered in CLI (no UI)
 *
 * @module domain/layout-blocks
 * @since 1.0.0
 */

/**
 * Supported layout block renderer types.
 * Maps to exo-ui:LayoutBlock_renderer values.
 */
export type LayoutBlockRenderer =
  | "identity"           // Identity block: label, uid, createdAt
  | "classification"     // Classification block: class, prototype
  | "relations-table"    // Relations table (inbound or outbound)
  | "backlinks-table"    // Backlinks table (legacy name)
  | "usage-context"      // Usage context: collections, body mentions, parent
  | "markdown"           // Markdown body content
  | string;              // Allow custom renderers

/**
 * Layout block definition loaded from RDF.
 */
export interface LayoutBlock {
  /**
   * Block URI (e.g., "exo-ui:InboundRelationsBlock")
   */
  uri: string;

  /**
   * Human-readable label for the block.
   * Maps to rdfs:label.
   */
  label: string;

  /**
   * SPARQL query template with ?asset placeholder.
   * The placeholder is replaced with the actual asset URI before execution.
   * Maps to exo-ui:LayoutBlock_query.
   */
  query: string;

  /**
   * Renderer component name.
   * Maps to exo-ui:LayoutBlock_renderer.
   */
  renderer: LayoutBlockRenderer;

  /**
   * Display order in the layout (1-based).
   * Maps to exo-ui:LayoutBlock_order.
   */
  order: number;

  /**
   * Whether this block can be rendered without UI (CLI-compatible).
   * Maps to exo-ui:LayoutBlock_headless.
   * @default true
   */
  headless: boolean;
}

/**
 * Result of loading a layout with its blocks.
 */
export interface LayoutWithBlocks {
  /**
   * Layout URI (e.g., "exo-ui:DefaultAssetLayout")
   */
  layoutUri: string;

  /**
   * Layout label
   */
  label: string;

  /**
   * Ordered list of blocks in this layout
   */
  blocks: LayoutBlock[];
}

/**
 * Result of executing a layout block query.
 */
export interface LayoutBlockQueryResult {
  /**
   * The block that was executed
   */
  block: LayoutBlock;

  /**
   * Query results as key-value pairs
   */
  bindings: Record<string, unknown>[];
}

/**
 * Constants for well-known layout and block URIs.
 */
export const LAYOUT_URIS = {
  /** Default asset layout with standard blocks */
  DEFAULT_ASSET_LAYOUT: "https://exocortex.my/ontology/exo-ui#DefaultAssetLayout",
} as const;

export const LAYOUT_BLOCK_URIS = {
  /** Identity block: label, uid, createdAt */
  IDENTITY: "https://exocortex.my/ontology/exo-ui#IdentityBlock",
  /** Classification block: class, prototype */
  CLASSIFICATION: "https://exocortex.my/ontology/exo-ui#ClassificationBlock",
  /** Inbound relations block: who references this asset */
  INBOUND_RELATIONS: "https://exocortex.my/ontology/exo-ui#InboundRelationsBlock",
  /** Outbound relations block: what this asset references */
  OUTBOUND_RELATIONS: "https://exocortex.my/ontology/exo-ui#OutboundRelationsBlock",
  /** Usage context block: collections, body mentions, parent */
  USAGE_CONTEXT: "https://exocortex.my/ontology/exo-ui#UsageContextBlock",
  /** Body content block: markdown content */
  BODY_CONTENT: "https://exocortex.my/ontology/exo-ui#BodyContentBlock",
} as const;

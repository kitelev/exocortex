/**
 * Core node data structure for knowledge graph visualization.
 * Contains asset metadata extracted from the triple store.
 */
export interface GraphNodeData {
  /** Unique identifier (file path or URI) */
  id: string;
  /** File path in vault */
  path: string;
  /** Display title (from exo:Asset_label or filename) */
  title: string;
  /** Short display label */
  label: string;
  /** Ontology class (e.g., "ems__Task", "ems__Project") */
  assetClass?: string;
  /** Whether the asset is archived */
  isArchived: boolean;
  /** URI in the triple store */
  uri?: string;
  /** Prototype/template URI if applicable */
  prototype?: string;
  /** Parent asset URI (for hierarchical relationships) */
  parent?: string;
  /** Timestamp of last modification */
  lastModified?: number;
  /** Custom properties from frontmatter */
  properties?: Record<string, unknown>;
  /** Number of incoming edges (backlinks) */
  inDegree?: number;
  /** Number of outgoing edges (forward links) */
  outDegree?: number;
}

/**
 * Graph node with layout positioning for force-directed graph.
 * Extends GraphNodeData with D3.js force simulation properties.
 */
export interface GraphNode extends GraphNodeData {
  /** Current x position */
  x?: number;
  /** Current y position */
  y?: number;
  /** Current x velocity */
  vx?: number;
  /** Current y velocity */
  vy?: number;
  /** Fixed x position (null = not fixed) */
  fx?: number | null;
  /** Fixed y position (null = not fixed) */
  fy?: number | null;
  /** Node weight for force simulation (based on connections) */
  weight?: number;
  /** Node group/cluster for coloring */
  group?: number;
}

/**
 * Type guard to check if a node has position data
 */
export function hasPosition(node: GraphNode): node is GraphNode & { x: number; y: number } {
  return typeof node.x === "number" && typeof node.y === "number";
}

/**
 * Type guard to check if a node is fixed
 */
export function isFixed(node: GraphNode): boolean {
  return node.fx !== null && node.fx !== undefined && node.fy !== null && node.fy !== undefined;
}

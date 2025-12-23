/**
 * Edge types in the knowledge graph.
 */
export type GraphEdgeType =
  | "backlink"        // Implicit reverse link
  | "forward-link"    // Wiki-link in content
  | "hierarchy"       // Parent-child relationship (ems:parent)
  | "prototype"       // Prototype relationship (exo:Asset_prototype)
  | "semantic"        // Semantic relationship from triple store
  | "reference";      // Property reference

/**
 * Edge data structure for knowledge graph visualization.
 * Represents a directed relationship between two nodes.
 */
export interface GraphEdge {
  /** Unique edge identifier */
  id?: string;
  /** Source node ID (path or URI) */
  source: string;
  /** Target node ID (path or URI) */
  target: string;
  /** Type of relationship */
  type: GraphEdgeType;
  /** Predicate URI from triple store */
  predicate?: string;
  /** Human-readable label for the relationship */
  label?: string;
  /** Edge weight for layout algorithms */
  weight?: number;
  /** Whether this edge is bidirectional */
  bidirectional?: boolean;
  /** Custom properties */
  properties?: Record<string, unknown>;
}

/**
 * Edge with resolved node references for D3.js force simulation.
 * After simulation initialization, source and target are node objects.
 */
export interface GraphEdgeResolved<T> {
  id?: string;
  source: T;
  target: T;
  type: GraphEdgeType;
  predicate?: string;
  label?: string;
  weight?: number;
  bidirectional?: boolean;
  properties?: Record<string, unknown>;
}

/**
 * Create a unique edge ID from source, target, and type
 */
export function createEdgeId(source: string, target: string, type: GraphEdgeType, predicate?: string): string {
  const predicatePart = predicate ? `|${predicate}` : "";
  return `${source}->${target}:${type}${predicatePart}`;
}

/**
 * Check if two edges represent the same relationship
 */
export function edgesEqual(a: GraphEdge, b: GraphEdge): boolean {
  return a.source === b.source && a.target === b.target && a.type === b.type && a.predicate === b.predicate;
}

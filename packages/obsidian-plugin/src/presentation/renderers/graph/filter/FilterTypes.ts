/**
 * Filter Types for Graph Visualization
 *
 * Provides a semantic filtering system for graph exploration based on RDF types,
 * predicates, literal values, and custom SPARQL queries.
 *
 * @module presentation/renderers/graph/filter
 * @since 1.0.0
 */

/**
 * Base filter interface with common properties
 */
export interface BaseFilter {
  /** Unique identifier for this filter instance */
  id: string;
  /** Whether this filter is currently enabled */
  enabled: boolean;
}

/**
 * Filter by RDF type (asset class)
 * Shows or hides nodes based on their ontology class
 */
export interface TypeFilter extends BaseFilter {
  type: "type";
  /** List of type URIs to filter on (e.g., "ems__Task", "ems__Project") */
  typeUris: string[];
  /** If true, show only these types; if false, hide these types */
  include: boolean;
  /** Whether to include subclasses of specified types */
  includeSubclasses: boolean;
}

/**
 * Filter by edge predicate (relationship type)
 * Shows or hides edges based on their predicate URI
 */
export interface PredicateFilter extends BaseFilter {
  type: "predicate";
  /** List of predicate URIs to filter on */
  predicateUris: string[];
  /** Filter direction: incoming, outgoing, or both */
  direction: "incoming" | "outgoing" | "both";
  /** If true, show only these predicates; if false, hide these predicates */
  include: boolean;
}

/**
 * Filter by literal value of a property
 * Shows nodes where a specific property matches criteria
 */
export interface LiteralFilter extends BaseFilter {
  type: "literal";
  /** The predicate URI of the property to filter on */
  predicateUri: string;
  /** Comparison operator */
  operator: "equals" | "contains" | "startsWith" | "regex" | "gt" | "lt" | "gte" | "lte" | "between";
  /** Value to compare against (single value or range for 'between') */
  value: string | number | [number, number];
  /** Optional datatype restriction (e.g., "xsd:dateTime") */
  datatype?: string;
  /** Optional language tag restriction (e.g., "en") */
  language?: string;
}

/**
 * Filter by graph path distance from a starting node
 * Shows nodes within a specified distance from a focal node
 */
export interface PathFilter extends BaseFilter {
  type: "path";
  /** Starting node ID or URI */
  startNode: string;
  /** Maximum distance (number of hops) from start node */
  maxDistance: number;
  /** Optional restriction to specific predicates */
  predicates?: string[];
}

/**
 * Custom SPARQL-based filter
 * Uses ASK or SELECT query to determine visibility
 */
export interface CustomSPARQLFilter extends BaseFilter {
  type: "sparql";
  /** Human-readable name for this filter */
  name: string;
  /** SPARQL query (ASK or SELECT ?node) */
  query: string;
}

/**
 * Composite filter combining multiple filters
 */
export interface CompositeFilter extends BaseFilter {
  type: "composite";
  /** Logical operator to combine child filters */
  operator: "AND" | "OR" | "NOT";
  /** Child filters to combine */
  filters: GraphFilter[];
}

/**
 * Union type of all filter types
 */
export type GraphFilter =
  | TypeFilter
  | PredicateFilter
  | LiteralFilter
  | PathFilter
  | CustomSPARQLFilter
  | CompositeFilter;

/**
 * Filter preset configuration for quick access
 */
export interface FilterPreset {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Description of what this preset shows */
  description?: string;
  /** The filters to apply */
  filters: GraphFilter[];
}

/**
 * Filter state containing all active filters and presets
 */
export interface AdvancedFilterState {
  /** Currently active filters */
  activeFilters: Map<string, GraphFilter>;
  /** Available filter presets */
  presets: FilterPreset[];
  /** Currently applied preset ID (null if custom) */
  activePresetId: string | null;
  /** Cached filter results for performance */
  cachedResults: Map<string, Set<string>>;
  /** Whether filter panel is visible */
  isPanelVisible: boolean;
}

/**
 * Type counts for filter panel display
 */
export interface TypeCounts {
  /** Node type counts */
  nodeTypes: Map<string, number>;
  /** Edge type counts */
  edgeTypes: Map<string, number>;
}

/**
 * Filter panel configuration
 */
export interface FilterPanelConfig {
  /** Show type filter section */
  showTypeFilters: boolean;
  /** Show predicate filter section */
  showPredicateFilters: boolean;
  /** Show literal filter section */
  showLiteralFilters: boolean;
  /** Show path filter section */
  showPathFilters: boolean;
  /** Show custom SPARQL section */
  showCustomSPARQL: boolean;
  /** Show preset section */
  showPresets: boolean;
}

/**
 * Default filter panel configuration
 */
export const DEFAULT_FILTER_PANEL_CONFIG: FilterPanelConfig = {
  showTypeFilters: true,
  showPredicateFilters: true,
  showLiteralFilters: true,
  showPathFilters: true,
  showCustomSPARQL: false, // Advanced feature, hidden by default
  showPresets: true,
};

/**
 * Create a type filter
 */
export function createTypeFilter(
  id: string,
  typeUris: string[],
  include = true,
  includeSubclasses = false
): TypeFilter {
  return {
    type: "type",
    id,
    enabled: true,
    typeUris,
    include,
    includeSubclasses,
  };
}

/**
 * Create a predicate filter
 */
export function createPredicateFilter(
  id: string,
  predicateUris: string[],
  include = true,
  direction: "incoming" | "outgoing" | "both" = "both"
): PredicateFilter {
  return {
    type: "predicate",
    id,
    enabled: true,
    predicateUris,
    include,
    direction,
  };
}

/**
 * Create a literal filter
 */
export function createLiteralFilter(
  id: string,
  predicateUri: string,
  operator: LiteralFilter["operator"],
  value: string | number | [number, number]
): LiteralFilter {
  return {
    type: "literal",
    id,
    enabled: true,
    predicateUri,
    operator,
    value,
  };
}

/**
 * Create a path filter
 */
export function createPathFilter(
  id: string,
  startNode: string,
  maxDistance: number,
  predicates?: string[]
): PathFilter {
  return {
    type: "path",
    id,
    enabled: true,
    startNode,
    maxDistance,
    predicates,
  };
}

/**
 * Create a composite filter
 */
export function createCompositeFilter(
  id: string,
  operator: "AND" | "OR" | "NOT",
  filters: GraphFilter[]
): CompositeFilter {
  return {
    type: "composite",
    id,
    enabled: true,
    operator,
    filters,
  };
}

/**
 * Generate a unique filter ID
 */
export function generateFilterId(prefix = "filter"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

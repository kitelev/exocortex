/**
 * Type system for graph nodes and edges with RDF/OWL ontology support.
 * Enables semantic typing, custom styling, filtering, and grouping.
 */

/**
 * Standard RDF/OWL type predicates.
 */
export const RDF_TYPE_PREDICATES = {
  /** rdf:type - the standard RDF type predicate */
  RDF_TYPE: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
  /** rdfs:Class - RDFS class definition */
  RDFS_CLASS: "http://www.w3.org/2000/01/rdf-schema#Class",
  /** owl:Class - OWL class definition */
  OWL_CLASS: "http://www.w3.org/2002/07/owl#Class",
  /** rdfs:subClassOf - class hierarchy */
  RDFS_SUBCLASS_OF: "http://www.w3.org/2000/01/rdf-schema#subClassOf",
  /** owl:equivalentClass - class equivalence */
  OWL_EQUIVALENT_CLASS: "http://www.w3.org/2002/07/owl#equivalentClass",
  /** rdfs:label - human-readable label */
  RDFS_LABEL: "http://www.w3.org/2000/01/rdf-schema#label",
  /** rdfs:comment - description */
  RDFS_COMMENT: "http://www.w3.org/2000/01/rdf-schema#comment",
} as const;

/**
 * Style properties for graph nodes.
 */
export interface NodeStyle {
  /** Fill color (hex, rgb, or named color) */
  color?: string;
  /** Border color */
  borderColor?: string;
  /** Border width in pixels */
  borderWidth?: number;
  /** Node radius/size */
  size?: number;
  /** Shape: circle, square, diamond, triangle */
  shape?: "circle" | "square" | "diamond" | "triangle" | "hexagon";
  /** Icon identifier or URL */
  icon?: string;
  /** Opacity (0-1) */
  opacity?: number;
  /** Shadow for emphasis */
  shadow?: boolean;
  /** Animation effect */
  animation?: "none" | "pulse" | "glow";
}

/**
 * Style properties for graph edges.
 */
export interface EdgeStyle {
  /** Line color */
  color?: string;
  /** Line width in pixels */
  width?: number;
  /** Line style */
  lineStyle?: "solid" | "dashed" | "dotted";
  /** Arrow style for directed edges */
  arrow?: "none" | "standard" | "triangle" | "circle";
  /** Curvature (0 = straight, positive = curved) */
  curvature?: number;
  /** Opacity (0-1) */
  opacity?: number;
  /** Show label on edge */
  showLabel?: boolean;
  /** Label position along edge (0-1) */
  labelPosition?: number;
}

/**
 * Type source indicating where the type was derived from.
 */
export type TypeSource =
  | "rdf:type"           // Standard RDF type assertion
  | "rdfs:Class"         // RDFS class definition
  | "owl:Class"          // OWL class definition
  | "exo:Instance_class" // Exocortex instance class
  | "inferred"           // Inferred from class hierarchy
  | "custom";            // Custom/user-defined

/**
 * Definition of a node type in the graph.
 */
export interface NodeTypeDefinition {
  /** Unique type URI or identifier */
  uri: string;
  /** Human-readable label */
  label: string;
  /** Optional description */
  description?: string;
  /** Parent type URI(s) for inheritance */
  parentTypes?: string[];
  /** Source of this type definition */
  source: TypeSource;
  /** Default styling for nodes of this type */
  style: NodeStyle;
  /** Priority for styling conflicts (higher = more specific) */
  priority: number;
  /** Whether this type is deprecated */
  deprecated?: boolean;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Definition of an edge type in the graph.
 */
export interface EdgeTypeDefinition {
  /** Unique type URI or identifier (predicate) */
  uri: string;
  /** Human-readable label */
  label: string;
  /** Optional description */
  description?: string;
  /** Source domain (node types that can be sources) */
  domain?: string[];
  /** Target range (node types that can be targets) */
  range?: string[];
  /** Whether this edge is symmetric (bidirectional) */
  symmetric?: boolean;
  /** Inverse predicate URI if any */
  inverse?: string;
  /** Source of this type definition */
  source: TypeSource;
  /** Default styling for edges of this type */
  style: EdgeStyle;
  /** Priority for styling conflicts */
  priority: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Type information attached to a graph node.
 */
export interface NodeTypeInfo {
  /** Primary type URI */
  primaryType: string;
  /** All type URIs (including inherited) */
  types: string[];
  /** Resolved style (merged from all types) */
  resolvedStyle: NodeStyle;
  /** Source of primary type */
  source: TypeSource;
}

/**
 * Type information attached to a graph edge.
 */
export interface EdgeTypeInfo {
  /** Primary type URI (predicate) */
  primaryType: string;
  /** Resolved style */
  resolvedStyle: EdgeStyle;
  /** Source of type */
  source: TypeSource;
}

/**
 * Filter options for type-based queries.
 */
export interface TypeFilter {
  /** Include only these node types */
  includeNodeTypes?: string[];
  /** Exclude these node types */
  excludeNodeTypes?: string[];
  /** Include only these edge types */
  includeEdgeTypes?: string[];
  /** Exclude these edge types */
  excludeEdgeTypes?: string[];
  /** Include inferred types */
  includeInferred?: boolean;
  /** Include deprecated types */
  includeDeprecated?: boolean;
}

/**
 * Grouping configuration for type-based clustering.
 */
export interface TypeGrouping {
  /** Group nodes by type */
  groupByNodeType?: boolean;
  /** Group nodes by parent type (higher level) */
  groupByParentType?: boolean;
  /** Specific type level for grouping (0 = leaf, higher = more general) */
  groupLevel?: number;
  /** Maximum number of groups (excess becomes "Other") */
  maxGroups?: number;
  /** Custom grouping function */
  customGroupFn?: (types: string[]) => string;
}

/**
 * A group of nodes by type.
 */
export interface TypeGroup {
  /** Group identifier (type URI) */
  id: string;
  /** Group label */
  label: string;
  /** Node IDs in this group */
  nodeIds: string[];
  /** Edge IDs within this group */
  internalEdgeIds: string[];
  /** Edge IDs connecting to other groups */
  externalEdgeIds: string[];
  /** Group color for visualization */
  color?: string;
  /** Group statistics */
  stats: {
    nodeCount: number;
    internalEdgeCount: number;
    externalEdgeCount: number;
  };
}

/**
 * Validation result for type checking.
 */
export interface TypeValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Validation errors */
  errors: TypeValidationError[];
  /** Validation warnings */
  warnings: TypeValidationWarning[];
}

/**
 * A type validation error.
 */
export interface TypeValidationError {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Affected node/edge ID */
  elementId?: string;
  /** Expected type(s) */
  expected?: string[];
  /** Actual type(s) */
  actual?: string[];
}

/**
 * A type validation warning.
 */
export interface TypeValidationWarning {
  /** Warning code */
  code: string;
  /** Warning message */
  message: string;
  /** Affected node/edge ID */
  elementId?: string;
  /** Suggestion for resolution */
  suggestion?: string;
}

/**
 * Events emitted by the type registry.
 */
export type TypeRegistryEvent =
  | { type: "type-added"; typeUri: string; definition: NodeTypeDefinition | EdgeTypeDefinition }
  | { type: "type-updated"; typeUri: string; definition: NodeTypeDefinition | EdgeTypeDefinition }
  | { type: "type-removed"; typeUri: string }
  | { type: "hierarchy-updated"; rootTypes: string[] };

/**
 * Callback for type registry event subscriptions.
 */
export type TypeRegistryEventCallback = (event: TypeRegistryEvent) => void;

/**
 * Options for resolving node/edge styles from types.
 */
export interface StyleResolutionOptions {
  /** Merge styles from all types (vs. use highest priority) */
  mergeStyles?: boolean;
  /** Apply parent type styles first */
  inheritParentStyles?: boolean;
  /** Default style to use as base */
  defaultNodeStyle?: NodeStyle;
  defaultEdgeStyle?: EdgeStyle;
}

/**
 * Default node style values.
 */
export const DEFAULT_NODE_STYLE: Required<NodeStyle> = {
  color: "#6366f1",
  borderColor: "#4f46e5",
  borderWidth: 2,
  size: 30,
  shape: "circle",
  icon: "",
  opacity: 1,
  shadow: false,
  animation: "none",
};

/**
 * Default edge style values.
 */
export const DEFAULT_EDGE_STYLE: Required<EdgeStyle> = {
  color: "#9ca3af",
  width: 1,
  lineStyle: "solid",
  arrow: "standard",
  curvature: 0,
  opacity: 0.6,
  showLabel: false,
  labelPosition: 0.5,
};

/**
 * Built-in node type styles based on common ontology classes.
 */
export const BUILT_IN_NODE_STYLES: Record<string, Partial<NodeStyle>> = {
  // RDF/OWL meta types
  "http://www.w3.org/2000/01/rdf-schema#Class": {
    color: "#f59e0b",
    shape: "diamond",
    size: 40,
  },
  "http://www.w3.org/2002/07/owl#Class": {
    color: "#f59e0b",
    shape: "diamond",
    size: 40,
  },
  // Exocortex types
  "ems__Task": {
    color: "#22c55e",
    shape: "circle",
  },
  "ems__Project": {
    color: "#3b82f6",
    shape: "square",
  },
  "ems__Area": {
    color: "#8b5cf6",
    shape: "hexagon",
    size: 40,
  },
  "ems__Meeting": {
    color: "#ec4899",
    shape: "circle",
  },
  "exo__Class": {
    color: "#f59e0b",
    shape: "diamond",
  },
  "ims__Person": {
    color: "#06b6d4",
    shape: "circle",
  },
};

/**
 * Built-in edge type styles based on common predicates.
 */
export const BUILT_IN_EDGE_STYLES: Record<string, Partial<EdgeStyle>> = {
  // RDF/OWL relationships
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#type": {
    color: "#f59e0b",
    lineStyle: "dashed",
    arrow: "standard",
  },
  "http://www.w3.org/2000/01/rdf-schema#subClassOf": {
    color: "#8b5cf6",
    width: 2,
    arrow: "triangle",
  },
  // Exocortex relationships
  "https://exocortex.my/ontology/ems#Effort_parent": {
    color: "#6366f1",
    width: 2,
    arrow: "standard",
  },
  "https://exocortex.my/ontology/exo#Asset_prototype": {
    color: "#f59e0b",
    lineStyle: "dashed",
    arrow: "circle",
  },
  "https://exocortex.my/ontology/exo#references": {
    color: "#22c55e",
    opacity: 0.4,
    arrow: "standard",
  },
};

/**
 * Helper to merge two node styles, with source taking precedence.
 */
export function mergeNodeStyles(base: NodeStyle, override: NodeStyle): NodeStyle {
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(override).filter(([, v]) => v !== undefined)
    ),
  };
}

/**
 * Helper to merge two edge styles, with source taking precedence.
 */
export function mergeEdgeStyles(base: EdgeStyle, override: EdgeStyle): EdgeStyle {
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(override).filter(([, v]) => v !== undefined)
    ),
  };
}

/**
 * Extract local name from a URI.
 */
export function extractLocalName(uri: string): string {
  const hashIndex = uri.lastIndexOf("#");
  const slashIndex = uri.lastIndexOf("/");
  const separatorIndex = Math.max(hashIndex, slashIndex);
  if (separatorIndex >= 0) {
    return uri.substring(separatorIndex + 1);
  }
  return uri;
}

/**
 * Check if a type URI is an OWL/RDFS class type.
 */
export function isClassType(uri: string): boolean {
  return uri === RDF_TYPE_PREDICATES.RDFS_CLASS || uri === RDF_TYPE_PREDICATES.OWL_CLASS;
}

/**
 * Check if a predicate URI is a type predicate.
 */
export function isTypePredicate(predicateUri: string): boolean {
  return predicateUri === RDF_TYPE_PREDICATES.RDF_TYPE;
}

/**
 * Check if a predicate URI is a subclass predicate.
 */
export function isSubClassPredicate(predicateUri: string): boolean {
  return predicateUri === RDF_TYPE_PREDICATES.RDFS_SUBCLASS_OF;
}

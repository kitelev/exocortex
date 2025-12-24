/**
 * Graph Types
 *
 * Defines the types and interfaces for Graph visualization components.
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import type { LayoutColumn } from "../../../domain/layout";
import type { TableRow } from "../cell-renderers";

/**
 * Node data for graph visualization
 */
export interface GraphNode {
  /** Unique identifier for the node */
  id: string;

  /** Display label for the node */
  label: string;

  /** Path to the asset file */
  path: string;

  /** Additional node metadata */
  metadata?: Record<string, unknown>;

  /** Optional node group/category */
  group?: string;

  /** Optional node color */
  color?: string;

  /** Optional node size multiplier */
  size?: number;

  /** D3 simulation properties (added by force simulation) */
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

/**
 * Edge data for graph visualization
 */
export interface GraphEdge {
  /** Unique identifier for the edge */
  id: string;

  /** Source node ID */
  source: string | GraphNode;

  /** Target node ID */
  target: string | GraphNode;

  /** Edge label */
  label?: string;

  /** Property that created this edge */
  property?: string;

  /** Optional edge weight */
  weight?: number;

  /** Optional edge color */
  color?: string;
}

/**
 * Graph data container
 */
export interface GraphData {
  /** All nodes in the graph */
  nodes: GraphNode[];

  /** All edges in the graph */
  edges: GraphEdge[];
}

/**
 * Props for GraphLayoutRenderer
 */
export interface GraphLayoutRendererProps {
  /**
   * The GraphLayout definition
   */
  layout: {
    uid: string;
    label: string;
    nodeLabel?: string;
    edgeProperties?: string[];
    depth?: number;
    columns?: LayoutColumn[];
  };

  /**
   * Node data to display
   */
  nodes: GraphNode[];

  /**
   * Edge data to display
   */
  edges: GraphEdge[];

  /**
   * Handler for node clicks (navigation)
   */
  onNodeClick?: (nodeId: string, path: string, event: React.MouseEvent) => void;

  /**
   * Handler for edge clicks
   */
  onEdgeClick?: (edgeId: string, event: React.MouseEvent) => void;

  /**
   * Layout options
   */
  options?: GraphLayoutOptions;

  /**
   * Custom CSS class name
   */
  className?: string;
}

/**
 * Options for Graph layout rendering
 */
export interface GraphLayoutOptions {
  /** Width of the graph container (default: 100%) */
  width?: string | number;

  /** Height of the graph container (default: 400px) */
  height?: string | number;

  /** Node radius in pixels (default: 8) */
  nodeRadius?: number;

  /** Force simulation strength for charge (default: -300) */
  chargeStrength?: number;

  /** Force simulation link distance (default: 100) */
  linkDistance?: number;

  /** Whether to enable zoom and pan (default: true) */
  zoomable?: boolean;

  /** Minimum zoom level (default: 0.1) */
  minZoom?: number;

  /** Maximum zoom level (default: 4) */
  maxZoom?: number;

  /** Whether nodes are draggable (default: true) */
  draggable?: boolean;

  /** Whether to show node labels (default: true) */
  showLabels?: boolean;

  /** Whether to show edge labels (default: false) */
  showEdgeLabels?: boolean;

  /** Node color (CSS color or function) */
  nodeColor?: string | ((node: GraphNode) => string);

  /** Edge color (CSS color or function) */
  edgeColor?: string | ((edge: GraphEdge) => string);

  /** Initial zoom transform */
  initialZoom?: {
    x: number;
    y: number;
    k: number;
  };

  /**
   * Whether to use Barnes-Hut algorithm for many-body force calculation.
   * Provides O(n log n) complexity instead of O(n²) for large graphs.
   * @default true (enabled for graphs with > 100 nodes)
   */
  useBarnesHut?: boolean;

  /**
   * Barnes-Hut approximation threshold (theta).
   * Controls accuracy vs performance tradeoff:
   * - 0.0 → Exact calculation (O(n²))
   * - 0.5 → Good accuracy
   * - 0.9 → Default (good performance)
   * - 1.5 → Fast but less accurate
   * @default 0.9
   */
  barnesHutTheta?: number;

  /**
   * Minimum distance between nodes (prevents infinite forces)
   * @default 1
   */
  distanceMin?: number;

  /**
   * Maximum distance for force calculation (beyond this, force is 0)
   * @default Infinity
   */
  distanceMax?: number;
}

/**
 * Props for GraphNode component
 */
export interface GraphNodeProps {
  /** Node data */
  node: GraphNode;

  /** Node radius */
  radius?: number;

  /** Whether node is selected */
  isSelected?: boolean;

  /** Whether node is hovered */
  isHovered?: boolean;

  /** Whether node is draggable */
  isDraggable?: boolean;

  /** Node color */
  color?: string;

  /** Show label */
  showLabel?: boolean;

  /** Click handler */
  onClick?: (event: React.MouseEvent) => void;

  /** Mouse enter handler */
  onMouseEnter?: (event: React.MouseEvent) => void;

  /** Mouse leave handler */
  onMouseLeave?: (event: React.MouseEvent) => void;
}

/**
 * Props for GraphEdge component
 */
export interface GraphEdgeProps {
  /** Edge data */
  edge: GraphEdge;

  /** Source node position */
  sourceX: number;
  sourceY: number;

  /** Target node position */
  targetX: number;
  targetY: number;

  /** Whether edge is selected */
  isSelected?: boolean;

  /** Whether edge is hovered */
  isHovered?: boolean;

  /** Edge color */
  color?: string;

  /** Show label */
  showLabel?: boolean;

  /** Click handler */
  onClick?: (event: React.MouseEvent) => void;

  /** Mouse enter handler */
  onMouseEnter?: (event: React.MouseEvent) => void;

  /** Mouse leave handler */
  onMouseLeave?: (event: React.MouseEvent) => void;
}

/**
 * Extract label from wikilink reference or plain path.
 * "[[path/to/file|Label]]" -> "Label"
 * "[[path/to/file]]" -> "file"
 * "/path/to/file.md" -> "file"
 *
 * @param wikilink - The wikilink reference or plain path
 * @returns The extracted label
 */
export function extractLabelFromWikilink(wikilink: string): string {
  // Handle [[target|Label]] format
  const pipedMatch = wikilink.match(/\[\[([^|\]]+)\|([^\]]+)\]\]/);
  if (pipedMatch) {
    return pipedMatch[2];
  }

  // Handle [[target]] format - extract filename
  const match = wikilink.match(/\[\[([^\]]+)\]\]/);
  if (match) {
    const path = match[1];
    // Get last segment (filename without path)
    const segments = path.split("/");
    const filename = segments[segments.length - 1];
    // Remove .md extension if present
    return filename.replace(/\.md$/, "");
  }

  // Handle plain path - extract filename without extension
  if (wikilink.includes("/") || wikilink.endsWith(".md")) {
    const segments = wikilink.split("/");
    const filename = segments[segments.length - 1];
    return filename.replace(/\.md$/, "");
  }

  return wikilink;
}

/**
 * Extract target path from wikilink reference.
 * "[[path/to/file|Label]]" -> "path/to/file"
 *
 * @param wikilink - The wikilink reference
 * @returns The target path
 */
export function extractPathFromWikilink(wikilink: string): string {
  // Handle [[target|Label]] format
  const pipedMatch = wikilink.match(/\[\[([^|\]]+)\|([^\]]+)\]\]/);
  if (pipedMatch) {
    return pipedMatch[1];
  }

  // Handle [[target]] format
  const match = wikilink.match(/\[\[([^\]]+)\]\]/);
  if (match) {
    return match[1];
  }

  return wikilink;
}

/**
 * Convert TableRow array to GraphNode array.
 *
 * @param rows - The table rows to convert
 * @param labelColumn - The column UID to use for labels
 * @returns Array of GraphNode objects
 */
export function rowsToNodes(rows: TableRow[], labelColumn?: string): GraphNode[] {
  return rows.map((row) => ({
    id: row.id,
    label: labelColumn && row.values[labelColumn]
      ? String(row.values[labelColumn])
      : extractLabelFromWikilink(row.path),
    path: row.path,
    metadata: row.metadata,
  }));
}

/**
 * Extract edges from node relationships.
 *
 * @param rows - The table rows with relationship data
 * @param edgeProperties - Property UIDs to extract edges from
 * @returns Array of GraphEdge objects
 */
export function extractEdges(
  rows: TableRow[],
  edgeProperties: string[]
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  let edgeId = 0;

  for (const row of rows) {
    for (const property of edgeProperties) {
      const value = row.values[property];
      if (!value) continue;

      // Handle array of wikilinks
      const targets = Array.isArray(value) ? value : [value];

      for (const target of targets) {
        if (typeof target !== "string") continue;

        const targetPath = extractPathFromWikilink(String(target));
        if (targetPath && targetPath !== row.path) {
          edges.push({
            id: `edge-${edgeId++}`,
            source: row.id,
            target: targetPath,
            property: property,
            label: extractLabelFromWikilink(property),
          });
        }
      }
    }
  }

  return edges;
}

/**
 * Build a GraphData object from table rows.
 *
 * @param rows - The table rows
 * @param labelColumn - Column UID for node labels
 * @param edgeProperties - Property UIDs for edge extraction
 * @returns Complete GraphData object
 */
export function buildGraphData(
  rows: TableRow[],
  labelColumn?: string,
  edgeProperties: string[] = []
): GraphData {
  const nodes = rowsToNodes(rows, labelColumn);
  const edges = extractEdges(rows, edgeProperties);

  // Filter edges to only include those with valid node IDs
  const nodeIds = new Set(nodes.map((n) => n.id));
  const nodePaths = new Set(nodes.map((n) => n.path));

  const validEdges = edges.filter((edge) => {
    const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
    const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;
    return (
      (nodeIds.has(sourceId) || nodePaths.has(sourceId)) &&
      (nodeIds.has(targetId) || nodePaths.has(targetId))
    );
  });

  return { nodes, edges: validEdges };
}

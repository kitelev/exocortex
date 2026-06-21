/**
 * Memory Management Types for Large Graph Datasets
 *
 * Provides type definitions for memory-efficient graph data structures
 * using typed arrays and string interning for large-scale graph visualization.
 *
 * @module infrastructure/memory
 * @since 1.0.0
 */

/**
 * Compact node data stored in typed arrays for cache efficiency.
 *
 * Memory layout per node (using array indices):
 * - positions: 2 floats per node (x, y)
 * - radii: 1 float per node
 * - colors: 1 uint32 per node (packed RGBA)
 * - types: 1 uint16 per node (type index into TypeTable)
 * - flags: 1 uint8 per node (bit flags for pinned, visible, selected, etc.)
 */
export interface CompactNodeData {
  /** X, Y positions for all nodes (2 floats per node) */
  positions: Float32Array;
  /** Node radii for rendering */
  radii: Float32Array;
  /** Packed RGBA colors (0xRRGGBBAA format) */
  colors: Uint32Array;
  /** Type indices into StringTable */
  types: Uint16Array;
  /** Bit flags: 0x01=pinned, 0x02=visible, 0x04=selected, 0x08=hovered, 0x10=archived */
  flags: Uint8Array;
}

/**
 * Compact edge data stored in typed arrays.
 *
 * Memory layout per edge (using array indices):
 * - sourceIndices: 1 uint32 per edge (source node index)
 * - targetIndices: 1 uint32 per edge (target node index)
 * - predicateIndices: 1 uint16 per edge (predicate index into StringTable)
 * - widths: 1 float per edge
 * - colors: 1 uint32 per edge (packed RGBA)
 */
export interface CompactEdgeData {
  /** Source node indices */
  sourceIndices: Uint32Array;
  /** Target node indices */
  targetIndices: Uint32Array;
  /** Predicate/type indices into StringTable */
  predicateIndices: Uint16Array;
  /** Edge widths for rendering */
  widths: Float32Array;
  /** Packed RGBA colors */
  colors: Uint32Array;
}

/**
 * Node flag bit positions
 */
export const NODE_FLAGS = {
  /** Node position is pinned/fixed */
  PINNED: 0x01,
  /** Node is visible (not filtered) */
  VISIBLE: 0x02,
  /** Node is currently selected */
  SELECTED: 0x04,
  /** Node is currently hovered */
  HOVERED: 0x08,
  /** Node is archived */
  ARCHIVED: 0x10,
  /** Node is part of current search results */
  SEARCH_MATCH: 0x20,
  /** Node is highlighted (e.g., neighbor of selected) */
  HIGHLIGHTED: 0x40,
} as const;

/**
 * Default colors for nodes and edges
 */
export const DEFAULT_COLORS = {
  /** Default node color (light blue) */
  NODE: 0x4a90d9ff,
  /** Selected node color (yellow) */
  NODE_SELECTED: 0xffc107ff,
  /** Hovered node color (light green) */
  NODE_HOVERED: 0x66bb6aff,
  /** Default edge color (gray) */
  EDGE: 0x999999ff,
  /** Selected edge color (orange) */
  EDGE_SELECTED: 0xff9800ff,
  /** Hierarchy edge color (purple) */
  EDGE_HIERARCHY: 0x9c27b0ff,
} as const;

/**
 * Configuration for CompactGraphStore
 */
export interface CompactGraphStoreConfig {
  /** Initial capacity for nodes (default: 10000) */
  initialNodeCapacity?: number;
  /** Initial capacity for edges (default: 50000) */
  initialEdgeCapacity?: number;
  /** Growth factor when resizing (default: 2.0) */
  growthFactor?: number;
  /** Maximum capacity before streaming is required */
  maxCapacity?: number;
}

/**
 * Statistics about memory usage
 */
export interface MemoryStats {
  /** Number of nodes currently stored */
  nodeCount: number;
  /** Number of edges currently stored */
  edgeCount: number;
  /** Current node capacity */
  nodeCapacity: number;
  /** Current edge capacity */
  edgeCapacity: number;
  /** Approximate memory used for nodes (bytes) */
  nodeMemoryBytes: number;
  /** Approximate memory used for edges (bytes) */
  edgeMemoryBytes: number;
  /** Total memory used by StringTable (bytes) */
  stringTableBytes: number;
  /** Total approximate memory usage (bytes) */
  totalBytes: number;
  /** Number of interned strings */
  internedStringCount: number;
}

/**
 * Interface for sparse update operations
 */
export interface NodeUpdate {
  /** Node index to update */
  index: number;
  /** New X position (optional) */
  x?: number;
  /** New Y position (optional) */
  y?: number;
  /** New radius (optional) */
  radius?: number;
  /** New color (optional) */
  color?: number;
  /** Flags to set (optional) */
  setFlags?: number;
  /** Flags to clear (optional) */
  clearFlags?: number;
}

/**
 * Batch update result
 */
export interface BatchUpdateResult {
  /** Number of nodes updated */
  nodesUpdated: number;
  /** Number of edges updated */
  edgesUpdated: number;
  /** Time taken in milliseconds */
  timeMs: number;
}

/**
 * Streaming chunk for incremental loading
 */
export interface GraphChunk {
  /** Chunk sequence number */
  chunkIndex: number;
  /** Total number of chunks (if known) */
  totalChunks?: number;
  /** Nodes in this chunk */
  nodes: ChunkNode[];
  /** Edges in this chunk */
  edges: ChunkEdge[];
  /** Whether this is the last chunk */
  isLast: boolean;
}

/**
 * Node data for streaming chunk
 */
export interface ChunkNode {
  /** Original node ID/URI */
  id: string;
  /** Display label */
  label: string;
  /** Asset class/type */
  assetClass?: string;
  /** Initial X position */
  x?: number;
  /** Initial Y position */
  y?: number;
  /** Node radius */
  radius?: number;
  /** Color (hex number or string) */
  color?: number | string;
  /** Whether node is archived */
  isArchived?: boolean;
  /** Whether node is pinned */
  isPinned?: boolean;
}

/**
 * Edge data for streaming chunk
 */
export interface ChunkEdge {
  /** Source node ID */
  sourceId: string;
  /** Target node ID */
  targetId: string;
  /** Edge predicate/type */
  predicate?: string;
  /** Edge width */
  width?: number;
  /** Edge color */
  color?: number | string;
}

/**
 * Event emitted when streaming progress changes
 */
export interface StreamingProgressEvent {
  /** Current chunk being processed */
  currentChunk: number;
  /** Total chunks (if known) */
  totalChunks?: number;
  /** Nodes loaded so far */
  nodesLoaded: number;
  /** Edges loaded so far */
  edgesLoaded: number;
  /** Estimated progress (0-1) */
  progress: number;
  /** Whether loading is complete */
  isComplete: boolean;
}

/**
 * Callback for streaming progress
 */
export type StreamingProgressCallback = (event: StreamingProgressEvent) => void;

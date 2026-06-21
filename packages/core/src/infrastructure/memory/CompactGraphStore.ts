/**
 * CompactGraphStore - Memory-Efficient Graph Data Structure
 *
 * Provides a compact, cache-friendly representation of graph data using
 * typed arrays instead of object-based structures. Designed for handling
 * large graphs with 10k+ nodes efficiently.
 *
 * Features:
 * - TypedArray-based storage for cache efficiency
 * - String interning for URIs and labels
 * - O(1) lookup by ID
 * - Dynamic resizing with growth factor
 * - Memory usage tracking
 *
 * @module infrastructure/memory
 * @since 1.0.0
 */

import { StringTable } from "./StringTable";
import type {
  CompactNodeData,
  CompactEdgeData,
  CompactGraphStoreConfig,
  MemoryStats,
  NodeUpdate,
  BatchUpdateResult,
  ChunkNode,
  ChunkEdge,
  GraphChunk,
} from "./types";
import { NODE_FLAGS, DEFAULT_COLORS } from "./types";

/**
 * Memory Layout Documentation:
 *
 * Bytes per node in typed arrays:
 * - positions: 8 bytes (2 x Float32)
 * - radii: 4 bytes (Float32)
 * - colors: 4 bytes (Uint32)
 * - types: 2 bytes (Uint16)
 * - flags: 1 byte (Uint8)
 * Total: ~19 bytes per node (plus string table references)
 *
 * Bytes per edge in typed arrays:
 * - sourceIndices: 4 bytes (Uint32)
 * - targetIndices: 4 bytes (Uint32)
 * - predicateIndices: 2 bytes (Uint16)
 * - widths: 4 bytes (Float32)
 * - colors: 4 bytes (Uint32)
 * Total: ~18 bytes per edge (plus string table references)
 */

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<CompactGraphStoreConfig> = {
  initialNodeCapacity: 10000,
  initialEdgeCapacity: 50000,
  growthFactor: 2.0,
  maxCapacity: 1000000,
};

/**
 * Parse a color value from various formats to a Uint32 RGBA value.
 *
 * @param color - Color as number, hex string, or undefined
 * @param defaultColor - Default color if undefined
 * @returns Uint32 RGBA color
 */
function parseColor(
  color: number | string | undefined,
  defaultColor: number
): number {
  if (color === undefined) {
    return defaultColor;
  }
  if (typeof color === "number") {
    return color;
  }
  // Parse hex string like "#RRGGBB" or "#RRGGBBAA"
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    if (hex.length === 6) {
      return (parseInt(hex, 16) << 8) | 0xff;
    } else if (hex.length === 8) {
      return parseInt(hex, 16);
    }
  }
  return defaultColor;
}

/**
 * CompactGraphStore class for memory-efficient graph data storage.
 */
export class CompactGraphStore {
  private nodeCapacity: number;
  private edgeCapacity: number;
  private nodeCount = 0;
  private edgeCount = 0;

  private nodes: CompactNodeData;
  private edges: CompactEdgeData;

  /** String interning for URIs */
  private uriTable: StringTable;
  /** String interning for labels */
  private labelTable: StringTable;
  /** String interning for types/classes */
  private typeTable: StringTable;
  /** String interning for predicates */
  private predicateTable: StringTable;

  /** Map from node ID (URI) to array index */
  private nodeIdToIndex: Map<string, number> = new Map();
  /** Map from array index to node ID (URI) */
  private indexToNodeId: string[] = [];

  /** Map from edge ID to array index */
  private edgeIdToIndex: Map<string, number> = new Map();

  /** Configuration */
  private config: Required<CompactGraphStoreConfig>;

  /**
   * Create a new CompactGraphStore.
   *
   * @param config - Optional configuration
   */
  constructor(config?: CompactGraphStoreConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.nodeCapacity = this.config.initialNodeCapacity;
    this.edgeCapacity = this.config.initialEdgeCapacity;

    this.nodes = this.allocateNodeArrays(this.nodeCapacity);
    this.edges = this.allocateEdgeArrays(this.edgeCapacity);

    this.uriTable = new StringTable();
    this.labelTable = new StringTable();
    this.typeTable = new StringTable();
    this.predicateTable = new StringTable();
  }

  /**
   * Allocate typed arrays for node data.
   */
  private allocateNodeArrays(capacity: number): CompactNodeData {
    return {
      positions: new Float32Array(capacity * 2),
      radii: new Float32Array(capacity),
      colors: new Uint32Array(capacity),
      types: new Uint16Array(capacity),
      flags: new Uint8Array(capacity),
    };
  }

  /**
   * Allocate typed arrays for edge data.
   */
  private allocateEdgeArrays(capacity: number): CompactEdgeData {
    return {
      sourceIndices: new Uint32Array(capacity),
      targetIndices: new Uint32Array(capacity),
      predicateIndices: new Uint16Array(capacity),
      widths: new Float32Array(capacity),
      colors: new Uint32Array(capacity),
    };
  }

  /**
   * Resize node arrays to new capacity.
   */
  private resizeNodeArrays(newCapacity: number): void {
    if (newCapacity <= this.nodeCapacity) return;
    if (newCapacity > this.config.maxCapacity) {
      throw new Error(
        `Cannot resize beyond max capacity (${this.config.maxCapacity})`
      );
    }

    const newNodes = this.allocateNodeArrays(newCapacity);

    // Copy existing data
    newNodes.positions.set(this.nodes.positions.subarray(0, this.nodeCount * 2));
    newNodes.radii.set(this.nodes.radii.subarray(0, this.nodeCount));
    newNodes.colors.set(this.nodes.colors.subarray(0, this.nodeCount));
    newNodes.types.set(this.nodes.types.subarray(0, this.nodeCount));
    newNodes.flags.set(this.nodes.flags.subarray(0, this.nodeCount));

    this.nodes = newNodes;
    this.nodeCapacity = newCapacity;
  }

  /**
   * Resize edge arrays to new capacity.
   */
  private resizeEdgeArrays(newCapacity: number): void {
    if (newCapacity <= this.edgeCapacity) return;
    if (newCapacity > this.config.maxCapacity) {
      throw new Error(
        `Cannot resize beyond max capacity (${this.config.maxCapacity})`
      );
    }

    const newEdges = this.allocateEdgeArrays(newCapacity);

    // Copy existing data
    newEdges.sourceIndices.set(
      this.edges.sourceIndices.subarray(0, this.edgeCount)
    );
    newEdges.targetIndices.set(
      this.edges.targetIndices.subarray(0, this.edgeCount)
    );
    newEdges.predicateIndices.set(
      this.edges.predicateIndices.subarray(0, this.edgeCount)
    );
    newEdges.widths.set(this.edges.widths.subarray(0, this.edgeCount));
    newEdges.colors.set(this.edges.colors.subarray(0, this.edgeCount));

    this.edges = newEdges;
    this.edgeCapacity = newCapacity;
  }

  /**
   * Ensure capacity for at least n more nodes.
   */
  private ensureNodeCapacity(additionalNodes: number): void {
    const required = this.nodeCount + additionalNodes;
    if (required > this.nodeCapacity) {
      const newCapacity = Math.max(
        required,
        Math.floor(this.nodeCapacity * this.config.growthFactor)
      );
      this.resizeNodeArrays(newCapacity);
    }
  }

  /**
   * Ensure capacity for at least n more edges.
   */
  private ensureEdgeCapacity(additionalEdges: number): void {
    const required = this.edgeCount + additionalEdges;
    if (required > this.edgeCapacity) {
      const newCapacity = Math.max(
        required,
        Math.floor(this.edgeCapacity * this.config.growthFactor)
      );
      this.resizeEdgeArrays(newCapacity);
    }
  }

  /**
   * Add a single node to the store.
   *
   * @param node - Node data to add
   * @returns The index of the added node
   */
  public addNode(node: ChunkNode): number {
    // Check if node already exists
    const existing = this.nodeIdToIndex.get(node.id);
    if (existing !== undefined) {
      // Update existing node
      this.updateNodeAt(existing, node);
      return existing;
    }

    this.ensureNodeCapacity(1);

    const index = this.nodeCount++;
    const posOffset = index * 2;

    // Store position
    this.nodes.positions[posOffset] = node.x ?? Math.random() * 1000 - 500;
    this.nodes.positions[posOffset + 1] = node.y ?? Math.random() * 1000 - 500;

    // Store radius
    this.nodes.radii[index] = node.radius ?? 8;

    // Store color
    this.nodes.colors[index] = parseColor(node.color, DEFAULT_COLORS.NODE);

    // Store type (interned)
    if (node.assetClass) {
      this.nodes.types[index] = this.typeTable.intern(node.assetClass);
    } else {
      this.nodes.types[index] = 0;
    }

    // Store flags
    let flags = NODE_FLAGS.VISIBLE;
    if (node.isPinned) flags |= NODE_FLAGS.PINNED;
    if (node.isArchived) flags |= NODE_FLAGS.ARCHIVED;
    this.nodes.flags[index] = flags;

    // Store ID mappings
    this.nodeIdToIndex.set(node.id, index);
    this.indexToNodeId[index] = node.id;

    // Intern the ID/URI and label
    this.uriTable.intern(node.id);
    if (node.label) {
      this.labelTable.intern(node.label);
    }

    return index;
  }

  /**
   * Update node data at a specific index.
   */
  private updateNodeAt(index: number, node: ChunkNode): void {
    const posOffset = index * 2;

    if (node.x !== undefined) {
      this.nodes.positions[posOffset] = node.x;
    }
    if (node.y !== undefined) {
      this.nodes.positions[posOffset + 1] = node.y;
    }
    if (node.radius !== undefined) {
      this.nodes.radii[index] = node.radius;
    }
    if (node.color !== undefined) {
      this.nodes.colors[index] = parseColor(node.color, DEFAULT_COLORS.NODE);
    }
    if (node.assetClass !== undefined) {
      this.nodes.types[index] = this.typeTable.intern(node.assetClass);
    }

    // Update flags
    let flags = this.nodes.flags[index];
    if (node.isPinned !== undefined) {
      flags = node.isPinned
        ? flags | NODE_FLAGS.PINNED
        : flags & ~NODE_FLAGS.PINNED;
    }
    if (node.isArchived !== undefined) {
      flags = node.isArchived
        ? flags | NODE_FLAGS.ARCHIVED
        : flags & ~NODE_FLAGS.ARCHIVED;
    }
    this.nodes.flags[index] = flags;
  }

  /**
   * Add a single edge to the store.
   *
   * @param edge - Edge data to add
   * @returns The index of the added edge, or -1 if nodes don't exist
   */
  public addEdge(edge: ChunkEdge): number {
    const sourceIndex = this.nodeIdToIndex.get(edge.sourceId);
    const targetIndex = this.nodeIdToIndex.get(edge.targetId);

    if (sourceIndex === undefined || targetIndex === undefined) {
      return -1; // Nodes don't exist yet
    }

    // Generate edge ID
    const edgeId = `${edge.sourceId}->${edge.targetId}:${edge.predicate ?? "link"}`;

    // Check if edge already exists
    const existing = this.edgeIdToIndex.get(edgeId);
    if (existing !== undefined) {
      return existing;
    }

    this.ensureEdgeCapacity(1);

    const index = this.edgeCount++;

    this.edges.sourceIndices[index] = sourceIndex;
    this.edges.targetIndices[index] = targetIndex;
    this.edges.widths[index] = edge.width ?? 1;
    this.edges.colors[index] = parseColor(edge.color, DEFAULT_COLORS.EDGE);

    if (edge.predicate) {
      this.edges.predicateIndices[index] = this.predicateTable.intern(
        edge.predicate
      );
    } else {
      this.edges.predicateIndices[index] = 0;
    }

    this.edgeIdToIndex.set(edgeId, index);

    return index;
  }

  /**
   * Add multiple nodes in batch.
   *
   * @param nodes - Array of nodes to add
   * @returns Array of indices for added nodes
   */
  public addNodes(nodes: ChunkNode[]): number[] {
    this.ensureNodeCapacity(nodes.length);
    return nodes.map((node) => this.addNode(node));
  }

  /**
   * Add multiple edges in batch.
   *
   * @param edges - Array of edges to add
   * @returns Array of indices for added edges (-1 for edges with missing nodes)
   */
  public addEdges(edges: ChunkEdge[]): number[] {
    this.ensureEdgeCapacity(edges.length);
    return edges.map((edge) => this.addEdge(edge));
  }

  /**
   * Load a graph chunk (streaming).
   *
   * @param chunk - The chunk to load
   * @returns Number of nodes and edges added
   */
  public loadChunk(chunk: GraphChunk): { nodesAdded: number; edgesAdded: number } {
    // Add nodes first
    const nodeIndices = this.addNodes(chunk.nodes);
    const nodesAdded = nodeIndices.filter((i) => i >= 0).length;

    // Then add edges
    const edgeIndices = this.addEdges(chunk.edges);
    const edgesAdded = edgeIndices.filter((i) => i >= 0).length;

    return { nodesAdded, edgesAdded };
  }

  /**
   * Get node position by ID.
   *
   * @param nodeId - The node ID
   * @returns Position object or null if not found
   */
  public getNodePosition(nodeId: string): { x: number; y: number } | null {
    const index = this.nodeIdToIndex.get(nodeId);
    if (index === undefined) return null;

    const posOffset = index * 2;
    return {
      x: this.nodes.positions[posOffset],
      y: this.nodes.positions[posOffset + 1],
    };
  }

  /**
   * Get node position by index.
   *
   * @param index - The node index
   * @returns Position object
   */
  public getNodePositionByIndex(index: number): { x: number; y: number } {
    const posOffset = index * 2;
    return {
      x: this.nodes.positions[posOffset],
      y: this.nodes.positions[posOffset + 1],
    };
  }

  /**
   * Set node position by ID.
   *
   * @param nodeId - The node ID
   * @param x - New X position
   * @param y - New Y position
   * @returns true if node was found and updated
   */
  public setNodePosition(nodeId: string, x: number, y: number): boolean {
    const index = this.nodeIdToIndex.get(nodeId);
    if (index === undefined) return false;

    const posOffset = index * 2;
    this.nodes.positions[posOffset] = x;
    this.nodes.positions[posOffset + 1] = y;
    return true;
  }

  /**
   * Set node position by index.
   *
   * @param index - The node index
   * @param x - New X position
   * @param y - New Y position
   */
  public setNodePositionByIndex(index: number, x: number, y: number): void {
    const posOffset = index * 2;
    this.nodes.positions[posOffset] = x;
    this.nodes.positions[posOffset + 1] = y;
  }

  /**
   * Batch update node positions.
   * Optimized for animation frames.
   *
   * @param positions - Map of node ID to position
   * @returns Number of nodes updated
   */
  public updateNodePositions(
    positions: Map<string, { x: number; y: number }>
  ): number {
    let updated = 0;
    for (const [nodeId, pos] of positions) {
      if (this.setNodePosition(nodeId, pos.x, pos.y)) {
        updated++;
      }
    }
    return updated;
  }

  /**
   * Apply sparse updates to nodes.
   *
   * @param updates - Array of update operations
   * @returns Result with count and timing
   */
  public applyNodeUpdates(updates: NodeUpdate[]): BatchUpdateResult {
    const start = performance.now();
    let nodesUpdated = 0;

    for (const update of updates) {
      const index = update.index;
      if (index < 0 || index >= this.nodeCount) continue;

      if (update.x !== undefined || update.y !== undefined) {
        const posOffset = index * 2;
        if (update.x !== undefined) {
          this.nodes.positions[posOffset] = update.x;
        }
        if (update.y !== undefined) {
          this.nodes.positions[posOffset + 1] = update.y;
        }
      }

      if (update.radius !== undefined) {
        this.nodes.radii[index] = update.radius;
      }

      if (update.color !== undefined) {
        this.nodes.colors[index] = update.color;
      }

      if (update.setFlags !== undefined) {
        this.nodes.flags[index] |= update.setFlags;
      }

      if (update.clearFlags !== undefined) {
        this.nodes.flags[index] &= ~update.clearFlags;
      }

      nodesUpdated++;
    }

    return {
      nodesUpdated,
      edgesUpdated: 0,
      timeMs: performance.now() - start,
    };
  }

  /**
   * Get node flags by ID.
   *
   * @param nodeId - The node ID
   * @returns Flags or 0 if not found
   */
  public getNodeFlags(nodeId: string): number {
    const index = this.nodeIdToIndex.get(nodeId);
    if (index === undefined) return 0;
    return this.nodes.flags[index];
  }

  /**
   * Set a flag on a node.
   *
   * @param nodeId - The node ID
   * @param flag - The flag to set
   * @returns true if node was found
   */
  public setNodeFlag(nodeId: string, flag: number): boolean {
    const index = this.nodeIdToIndex.get(nodeId);
    if (index === undefined) return false;
    this.nodes.flags[index] |= flag;
    return true;
  }

  /**
   * Clear a flag on a node.
   *
   * @param nodeId - The node ID
   * @param flag - The flag to clear
   * @returns true if node was found
   */
  public clearNodeFlag(nodeId: string, flag: number): boolean {
    const index = this.nodeIdToIndex.get(nodeId);
    if (index === undefined) return false;
    this.nodes.flags[index] &= ~flag;
    return true;
  }

  /**
   * Check if a node has a specific flag.
   *
   * @param nodeId - The node ID
   * @param flag - The flag to check
   * @returns true if the flag is set
   */
  public hasNodeFlag(nodeId: string, flag: number): boolean {
    const flags = this.getNodeFlags(nodeId);
    return (flags & flag) !== 0;
  }

  /**
   * Select a node by ID.
   *
   * @param nodeId - The node ID
   * @returns true if node was found
   */
  public selectNode(nodeId: string): boolean {
    return this.setNodeFlag(nodeId, NODE_FLAGS.SELECTED);
  }

  /**
   * Deselect a node by ID.
   *
   * @param nodeId - The node ID
   * @returns true if node was found
   */
  public deselectNode(nodeId: string): boolean {
    return this.clearNodeFlag(nodeId, NODE_FLAGS.SELECTED);
  }

  /**
   * Clear all selections.
   */
  public clearSelection(): void {
    for (let i = 0; i < this.nodeCount; i++) {
      this.nodes.flags[i] &= ~NODE_FLAGS.SELECTED;
    }
  }

  /**
   * Get all selected node IDs.
   *
   * @returns Array of selected node IDs
   */
  public getSelectedNodeIds(): string[] {
    const selected: string[] = [];
    for (let i = 0; i < this.nodeCount; i++) {
      if (this.nodes.flags[i] & NODE_FLAGS.SELECTED) {
        selected.push(this.indexToNodeId[i]);
      }
    }
    return selected;
  }

  /**
   * Get node ID by index.
   *
   * @param index - The node index
   * @returns Node ID or undefined
   */
  public getNodeId(index: number): string | undefined {
    return this.indexToNodeId[index];
  }

  /**
   * Get node index by ID.
   *
   * @param nodeId - The node ID
   * @returns Index or undefined
   */
  public getNodeIndex(nodeId: string): number | undefined {
    return this.nodeIdToIndex.get(nodeId);
  }

  /**
   * Check if a node exists.
   *
   * @param nodeId - The node ID
   * @returns true if the node exists
   */
  public hasNode(nodeId: string): boolean {
    return this.nodeIdToIndex.has(nodeId);
  }

  /**
   * Get the number of nodes.
   *
   * @returns Node count
   */
  public getNodeCount(): number {
    return this.nodeCount;
  }

  /**
   * Get the number of edges.
   *
   * @returns Edge count
   */
  public getEdgeCount(): number {
    return this.edgeCount;
  }

  /**
   * Get edges for a specific node.
   *
   * @param nodeId - The node ID
   * @returns Array of edge indices
   */
  public getNodeEdges(
    nodeId: string
  ): Array<{ edgeIndex: number; isSource: boolean }> {
    const nodeIndex = this.nodeIdToIndex.get(nodeId);
    if (nodeIndex === undefined) return [];

    const result: Array<{ edgeIndex: number; isSource: boolean }> = [];
    for (let i = 0; i < this.edgeCount; i++) {
      if (this.edges.sourceIndices[i] === nodeIndex) {
        result.push({ edgeIndex: i, isSource: true });
      } else if (this.edges.targetIndices[i] === nodeIndex) {
        result.push({ edgeIndex: i, isSource: false });
      }
    }
    return result;
  }

  /**
   * Get neighbors of a node.
   *
   * @param nodeId - The node ID
   * @returns Array of neighbor node IDs
   */
  public getNeighbors(nodeId: string): string[] {
    const nodeIndex = this.nodeIdToIndex.get(nodeId);
    if (nodeIndex === undefined) return [];

    const neighbors = new Set<string>();
    for (let i = 0; i < this.edgeCount; i++) {
      if (this.edges.sourceIndices[i] === nodeIndex) {
        const targetIndex = this.edges.targetIndices[i];
        neighbors.add(this.indexToNodeId[targetIndex]);
      } else if (this.edges.targetIndices[i] === nodeIndex) {
        const sourceIndex = this.edges.sourceIndices[i];
        neighbors.add(this.indexToNodeId[sourceIndex]);
      }
    }
    return Array.from(neighbors);
  }

  /**
   * Get raw typed arrays for direct access (e.g., for GPU upload).
   *
   * @returns Object containing typed arrays
   */
  public getRawArrays(): {
    nodes: CompactNodeData;
    edges: CompactEdgeData;
    nodeCount: number;
    edgeCount: number;
  } {
    return {
      nodes: this.nodes,
      edges: this.edges,
      nodeCount: this.nodeCount,
      edgeCount: this.edgeCount,
    };
  }

  /**
   * Get positions array for all nodes.
   * Useful for GPU upload.
   *
   * @returns Float32Array with x,y pairs
   */
  public getPositionsArray(): Float32Array {
    return this.nodes.positions.subarray(0, this.nodeCount * 2);
  }

  /**
   * Get memory statistics.
   *
   * @returns Memory usage stats
   */
  public getMemoryStats(): MemoryStats {
    const nodeMemoryBytes =
      this.nodeCapacity * 2 * 4 + // positions
      this.nodeCapacity * 4 + // radii
      this.nodeCapacity * 4 + // colors
      this.nodeCapacity * 2 + // types
      this.nodeCapacity; // flags

    const edgeMemoryBytes =
      this.edgeCapacity * 4 + // sourceIndices
      this.edgeCapacity * 4 + // targetIndices
      this.edgeCapacity * 2 + // predicateIndices
      this.edgeCapacity * 4 + // widths
      this.edgeCapacity * 4; // colors

    const stringTableBytes =
      this.uriTable.getMemoryBytes() +
      this.labelTable.getMemoryBytes() +
      this.typeTable.getMemoryBytes() +
      this.predicateTable.getMemoryBytes();

    return {
      nodeCount: this.nodeCount,
      edgeCount: this.edgeCount,
      nodeCapacity: this.nodeCapacity,
      edgeCapacity: this.edgeCapacity,
      nodeMemoryBytes,
      edgeMemoryBytes,
      stringTableBytes,
      totalBytes: nodeMemoryBytes + edgeMemoryBytes + stringTableBytes,
      internedStringCount:
        this.uriTable.size +
        this.labelTable.size +
        this.typeTable.size +
        this.predicateTable.size,
    };
  }

  /**
   * Clear all data from the store.
   */
  public clear(): void {
    this.nodeCount = 0;
    this.edgeCount = 0;
    this.nodeIdToIndex.clear();
    this.indexToNodeId = [];
    this.edgeIdToIndex.clear();
    this.uriTable.clear();
    this.labelTable.clear();
    this.typeTable.clear();
    this.predicateTable.clear();

    // Reset arrays to initial capacity
    this.nodeCapacity = this.config.initialNodeCapacity;
    this.edgeCapacity = this.config.initialEdgeCapacity;
    this.nodes = this.allocateNodeArrays(this.nodeCapacity);
    this.edges = this.allocateEdgeArrays(this.edgeCapacity);
  }

  /**
   * Get the string table for types.
   *
   * @returns The type StringTable
   */
  public getTypeTable(): StringTable {
    return this.typeTable;
  }

  /**
   * Get the string table for labels.
   *
   * @returns The label StringTable
   */
  public getLabelTable(): StringTable {
    return this.labelTable;
  }

  /**
   * Get the string table for URIs.
   *
   * @returns The URI StringTable
   */
  public getUriTable(): StringTable {
    return this.uriTable;
  }

  /**
   * Get the string table for predicates.
   *
   * @returns The predicate StringTable
   */
  public getPredicateTable(): StringTable {
    return this.predicateTable;
  }
}

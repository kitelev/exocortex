/**
 * IncrementalRenderer - High-performance incremental graph rendering
 *
 * Implements dirty-checking and incremental updates to minimize rendering work.
 * Only redraws elements that have actually changed, dramatically improving
 * performance for large graphs.
 *
 * Features:
 * - Dirty-checking for positions, viewport, selection, style changes
 * - Per-node and per-edge incremental updates
 * - Automatic batching of rapid changes
 * - Statistics for performance monitoring
 * - Seamless integration with existing renderers
 * - Visibility culling for off-screen elements
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import { Container } from "pixi.js";
import type { GraphNode, GraphEdge } from "./types";
import {
  DirtyTracker,
  NodeEdgeIndex,
  type DirtyTrackerConfig,
  DEFAULT_DIRTY_TRACKER_CONFIG,
} from "./DirtyTracker";
import {
  NodeRenderer,
  NodeStyleResolver,
  type RenderedNode,
} from "./NodeRenderer";
import {
  EdgeRenderer,
  EdgeStyleResolver,
  calculateEdgeEndpoints,
  type RenderedEdge,
  type Position,
} from "./EdgeRenderer";
import {
  LabelRenderer,
  LabelStyleResolver,
  type RenderedLabel,
  type ViewportInfo,
} from "./LabelRenderer";
import {
  VisibilityCuller,
  type VisibilityCullerConfig,
  type ViewportBounds,
  DEFAULT_VISIBILITY_CULLER_CONFIG,
} from "./VisibilityCuller";

/**
 * Configuration options for IncrementalRenderer
 */
export interface IncrementalRendererOptions {
  /** Node renderer options */
  nodeRenderer?: {
    poolSize?: number;
    labelFontFamily?: string;
    labelFontSize?: number;
  };

  /** Edge renderer options */
  edgeRenderer?: {
    poolSize?: number;
  };

  /** Label renderer options */
  labelRenderer?: {
    poolSize?: number;
    fontFamily?: string;
    fontSize?: number;
  };

  /** Dirty tracker configuration */
  dirtyTracker?: DirtyTrackerConfig;

  /** Visibility culler configuration */
  visibilityCuller?: VisibilityCullerConfig;

  /** Whether to enable visibility culling (default: true) */
  enableCulling?: boolean;

  /** Whether to enable label rendering (default: true) */
  enableLabels?: boolean;

  /** Minimum zoom level for showing labels (default: 0.3) */
  labelMinZoom?: number;

  /** Maximum zoom level for showing labels (default: 3) */
  labelMaxZoom?: number;
}

/**
 * Render statistics for performance monitoring
 */
export interface RenderStats {
  /** Total nodes in graph */
  totalNodes: number;
  /** Total edges in graph */
  totalEdges: number;
  /** Nodes updated in last render */
  nodesUpdated: number;
  /** Edges updated in last render */
  edgesUpdated: number;
  /** Labels updated in last render */
  labelsUpdated: number;
  /** Whether last render was incremental (not full) */
  wasIncremental: boolean;
  /** Dirty tracker efficiency ratio */
  efficiencyRatio: number;
  /** Last render duration in milliseconds */
  renderDurationMs: number;
  /** Visible nodes (after culling) */
  visibleNodes: number;
  /** Visible edges (after culling) */
  visibleEdges: number;
  /** Culling efficiency (1 - visible/total) */
  cullingEfficiency: number;
}

/**
 * IncrementalRenderer - Efficient incremental graph rendering
 *
 * @example
 * ```typescript
 * const renderer = new IncrementalRenderer();
 *
 * // Initialize with parent containers
 * renderer.initialize(edgeContainer, nodeContainer, labelContainer);
 *
 * // Set graph data
 * renderer.setGraph(nodes, edges);
 *
 * // Update on simulation tick (incremental)
 * renderer.updateNodePositions(updatedNodes);
 *
 * // Update viewport (only transforms containers)
 * renderer.updateViewport({ zoom: 1.5, bounds: { minX: -500, maxX: 500, minY: -400, maxY: 400 } });
 *
 * // Render only what changed
 * renderer.render();
 * ```
 */
export class IncrementalRenderer {
  /** Dirty tracker for change detection */
  private dirty: DirtyTracker;

  /** Node-to-edge index for efficient edge updates */
  private edgeIndex: NodeEdgeIndex;

  /** Visibility culler for off-screen elements */
  private culler: VisibilityCuller;

  /** Node renderer */
  private nodeRenderer: NodeRenderer;

  /** Edge renderer */
  private edgeRenderer: EdgeRenderer;

  /** Label renderer */
  private labelRenderer: LabelRenderer;

  /** Configuration */
  private config: Required<IncrementalRendererOptions>;

  /** Parent containers */
  private edgeContainer: Container | null = null;
  private nodeContainer: Container | null = null;
  private labelContainer: Container | null = null;

  /** Current graph data */
  private nodes: Map<string, GraphNode> = new Map();
  private edges: Map<string, GraphEdge> = new Map();

  /** Rendered elements */
  private renderedNodes: Map<string, RenderedNode> = new Map();
  private renderedEdges: Map<string, RenderedEdge> = new Map();
  private renderedLabels: Map<string, RenderedLabel> = new Map();

  /** Current viewport */
  private viewport: ViewportInfo = {
    zoom: 1,
    bounds: { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 },
  };

  /** Selection state */
  private selectedNodes: Set<string> = new Set();
  private hoveredNode: string | null = null;

  /** Render stats */
  private lastStats: RenderStats = {
    totalNodes: 0,
    totalEdges: 0,
    nodesUpdated: 0,
    edgesUpdated: 0,
    labelsUpdated: 0,
    wasIncremental: true,
    efficiencyRatio: 1,
    renderDurationMs: 0,
    visibleNodes: 0,
    visibleEdges: 0,
    cullingEfficiency: 0,
  };

  constructor(options: IncrementalRendererOptions = {}) {
    this.config = {
      nodeRenderer: options.nodeRenderer ?? {},
      edgeRenderer: options.edgeRenderer ?? {},
      labelRenderer: options.labelRenderer ?? {},
      dirtyTracker: {
        ...DEFAULT_DIRTY_TRACKER_CONFIG,
        ...(options.dirtyTracker ?? {}),
      },
      visibilityCuller: {
        ...DEFAULT_VISIBILITY_CULLER_CONFIG,
        ...(options.visibilityCuller ?? {}),
      },
      enableCulling: options.enableCulling ?? true,
      enableLabels: options.enableLabels ?? true,
      labelMinZoom: options.labelMinZoom ?? 0.3,
      labelMaxZoom: options.labelMaxZoom ?? 3,
    };

    this.dirty = new DirtyTracker();
    this.edgeIndex = new NodeEdgeIndex();
    this.culler = new VisibilityCuller(this.config.visibilityCuller);

    // Initialize renderers
    this.nodeRenderer = new NodeRenderer(
      new NodeStyleResolver(),
      this.config.nodeRenderer
    );
    this.edgeRenderer = new EdgeRenderer(
      new EdgeStyleResolver(),
      this.config.edgeRenderer
    );
    this.labelRenderer = new LabelRenderer(
      new LabelStyleResolver(),
      {
        textPoolSize: this.config.labelRenderer.poolSize,
        graphicsPoolSize: this.config.labelRenderer.poolSize,
      }
    );
  }

  /**
   * Initialize the renderer with parent containers
   *
   * @param edgeContainer - Container for edge graphics
   * @param nodeContainer - Container for node graphics
   * @param labelContainer - Container for label graphics
   */
  initialize(
    edgeContainer: Container,
    nodeContainer: Container,
    labelContainer: Container
  ): void {
    this.edgeContainer = edgeContainer;
    this.nodeContainer = nodeContainer;
    this.labelContainer = labelContainer;
  }

  /**
   * Set the complete graph data
   *
   * @param nodes - Array of graph nodes
   * @param edges - Array of graph edges
   */
  setGraph(nodes: GraphNode[], edges: GraphEdge[]): void {
    // Clear existing data
    this.clear();

    // Store new data
    for (const node of nodes) {
      this.nodes.set(node.id, node);
    }

    for (const edge of edges) {
      this.edges.set(edge.id, edge);
      // Build edge index
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;
      this.edgeIndex.addEdge(edge.id, sourceId, targetId);
    }

    // Build visibility culler index
    if (this.config.enableCulling) {
      this.culler.buildIndex(nodes);
    }

    // Mark everything dirty for initial render
    this.dirty.markDirty("data");
    this.dirty.markDirty("all");
  }

  /**
   * Add a node to the graph
   *
   * @param node - Node to add
   */
  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
    if (this.config.enableCulling) {
      this.culler.addNode(node);
    }
    this.dirty.markDirty("data");
    this.dirty.markNodeDirty(node.id);
  }

  /**
   * Remove a node from the graph
   *
   * @param nodeId - ID of node to remove
   */
  removeNode(nodeId: string): void {
    this.nodes.delete(nodeId);

    // Remove from visibility culler
    if (this.config.enableCulling) {
      this.culler.removeNode(nodeId);
    }

    // Remove associated edges
    const connectedEdges = this.edgeIndex.getEdgesForNode(nodeId);
    for (const edgeId of connectedEdges) {
      this.edges.delete(edgeId);
      this.edgeIndex.removeEdge(edgeId);
      this.dirty.markEdgeDirty(edgeId);
    }

    this.dirty.markDirty("data");

    // Clean up rendered elements
    const renderedNode = this.renderedNodes.get(nodeId);
    if (renderedNode) {
      this.nodeRenderer.removeNode(nodeId);
      this.renderedNodes.delete(nodeId);
    }

    const renderedLabel = this.renderedLabels.get(nodeId);
    if (renderedLabel) {
      this.labelRenderer.removeLabel(nodeId);
      this.renderedLabels.delete(nodeId);
    }
  }

  /**
   * Add an edge to the graph
   *
   * @param edge - Edge to add
   */
  addEdge(edge: GraphEdge): void {
    this.edges.set(edge.id, edge);
    const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
    const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;
    this.edgeIndex.addEdge(edge.id, sourceId, targetId);
    this.dirty.markDirty("data");
    this.dirty.markEdgeDirty(edge.id);
  }

  /**
   * Remove an edge from the graph
   *
   * @param edgeId - ID of edge to remove
   */
  removeEdge(edgeId: string): void {
    this.edges.delete(edgeId);
    this.edgeIndex.removeEdge(edgeId);
    this.dirty.markDirty("data");

    // Clean up rendered element
    const renderedEdge = this.renderedEdges.get(edgeId);
    if (renderedEdge) {
      this.edgeRenderer.removeEdge(edgeId);
      this.renderedEdges.delete(edgeId);
    }
  }

  /**
   * Update node positions (e.g., after force simulation tick)
   *
   * @param nodes - Nodes with updated positions
   */
  updateNodePositions(nodes: GraphNode[]): void {
    const positionUpdates: Array<{ nodeId: string; x: number; y: number; radius?: number }> = [];

    for (const node of nodes) {
      const existing = this.nodes.get(node.id);
      if (existing) {
        // Only mark dirty if position actually changed
        if (existing.x !== node.x || existing.y !== node.y) {
          existing.x = node.x;
          existing.y = node.y;
          this.dirty.markNodeDirty(node.id);
          // Mark connected edges as dirty
          this.dirty.markNodeEdgesDirty(
            node.id,
            this.edgeIndex.getNodeEdgesMap()
          );

          // Collect for culler batch update
          if (this.config.enableCulling) {
            positionUpdates.push({
              nodeId: node.id,
              x: node.x ?? 0,
              y: node.y ?? 0,
              radius: node.size,
            });
          }
        }
      }
    }

    // Batch update visibility culler
    if (this.config.enableCulling && positionUpdates.length > 0) {
      this.culler.updatePositions(positionUpdates);
    }
  }

  /**
   * Update viewport (pan/zoom)
   *
   * @param viewport - New viewport state
   */
  updateViewport(viewport: Partial<ViewportInfo>): void {
    const boundsChanged =
      viewport.bounds !== undefined &&
      (viewport.bounds.minX !== this.viewport.bounds.minX ||
        viewport.bounds.maxX !== this.viewport.bounds.maxX ||
        viewport.bounds.minY !== this.viewport.bounds.minY ||
        viewport.bounds.maxY !== this.viewport.bounds.maxY);

    const zoomChanged =
      viewport.zoom !== undefined && viewport.zoom !== this.viewport.zoom;

    if (zoomChanged || boundsChanged) {
      this.viewport = {
        zoom: viewport.zoom ?? this.viewport.zoom,
        bounds: viewport.bounds ?? this.viewport.bounds,
      };
      this.dirty.markDirty("viewport");

      // Labels may need update based on zoom level
      if (zoomChanged) {
        this.dirty.markDirty("labels");
        // Update the label renderer's viewport
        this.labelRenderer.updateViewport(this.viewport);
      }
    }
  }

  /**
   * Set selection state
   *
   * @param nodeIds - Set of selected node IDs
   */
  setSelection(nodeIds: Set<string>): void {
    // Find nodes that changed selection state
    const prevSelected = this.selectedNodes;
    const newSelected = nodeIds;

    // Nodes that were deselected
    for (const nodeId of prevSelected) {
      if (!newSelected.has(nodeId)) {
        this.dirty.markNodeDirty(nodeId);
      }
    }

    // Nodes that were selected
    for (const nodeId of newSelected) {
      if (!prevSelected.has(nodeId)) {
        this.dirty.markNodeDirty(nodeId);
      }
    }

    this.selectedNodes = new Set(nodeIds);
    if (prevSelected.size !== newSelected.size ||
        ![...prevSelected].every(id => newSelected.has(id))) {
      this.dirty.markDirty("selection");
    }
  }

  /**
   * Set hover state
   *
   * @param nodeId - Hovered node ID or null
   */
  setHover(nodeId: string | null): void {
    if (this.hoveredNode !== nodeId) {
      // Mark previous hover as dirty
      if (this.hoveredNode) {
        this.dirty.markNodeDirty(this.hoveredNode);
      }
      // Mark new hover as dirty
      if (nodeId) {
        this.dirty.markNodeDirty(nodeId);
      }
      this.hoveredNode = nodeId;
      this.dirty.markDirty("hover");
    }
  }

  /**
   * Toggle label visibility
   *
   * @param visible - Whether labels should be visible
   */
  setLabelsVisible(visible: boolean): void {
    this.config.enableLabels = visible;
    this.dirty.markDirty("labels");
  }

  /**
   * Perform incremental render
   *
   * Only updates elements that have changed since last render.
   */
  render(): void {
    if (!this.edgeContainer || !this.nodeContainer || !this.labelContainer) {
      return;
    }

    const startTime = performance.now();
    let nodesUpdated = 0;
    let edgesUpdated = 0;
    let labelsUpdated = 0;

    // Update visibility culling if viewport changed
    let visibleNodeIds: Set<string> | null = null;
    let visibleEdgeIds: Set<string> | null = null;

    if (this.config.enableCulling && this.dirty.isDirty("viewport")) {
      const viewportBounds: ViewportBounds = {
        left: this.viewport.bounds.minX,
        top: this.viewport.bounds.minY,
        right: this.viewport.bounds.maxX,
        bottom: this.viewport.bounds.maxY,
        zoom: this.viewport.zoom,
      };
      visibleNodeIds = this.culler.getVisibleNodes(viewportBounds);
      visibleEdgeIds = this.culler.getVisibleEdges(viewportBounds, Array.from(this.edges.values()));
    }

    const needsFullRedraw = this.dirty.needsFullRedraw();
    const wasIncremental = !needsFullRedraw;

    if (needsFullRedraw) {
      // Full redraw - update everything (respecting culling)
      nodesUpdated = this.renderAllNodes(visibleNodeIds);
      edgesUpdated = this.renderAllEdges(visibleEdgeIds);
      labelsUpdated = this.renderAllLabels(visibleNodeIds);
    } else {
      // Incremental update - only dirty elements
      if (this.dirty.isDirty("data")) {
        // Handle added/removed elements
        nodesUpdated += this.syncNodes(visibleNodeIds);
        edgesUpdated += this.syncEdges(visibleEdgeIds);
        labelsUpdated += this.syncLabels(visibleNodeIds);
      }

      if (this.dirty.isDirty("positions") || this.dirty.isDirty("selection") || this.dirty.isDirty("hover")) {
        const dirtyNodes = this.dirty.getDirtyNodes();
        nodesUpdated += this.updateDirtyNodes(dirtyNodes, visibleNodeIds);

        const dirtyEdges = this.dirty.getDirtyEdges();
        edgesUpdated += this.updateDirtyEdges(dirtyEdges, visibleEdgeIds);
      }

      if (this.dirty.isDirty("labels") || this.dirty.isDirty("viewport")) {
        labelsUpdated += this.updateLabels(visibleNodeIds);
      }

      if (this.dirty.isDirty("style")) {
        nodesUpdated += this.updateAllNodeStyles();
        edgesUpdated += this.updateAllEdgeStyles();
      }
    }

    const endTime = performance.now();

    // Get culling stats
    const cullerStats = this.config.enableCulling ? this.culler.getStats() : null;

    // Update stats
    this.lastStats = {
      totalNodes: this.nodes.size,
      totalEdges: this.edges.size,
      nodesUpdated,
      edgesUpdated,
      labelsUpdated,
      wasIncremental,
      efficiencyRatio: this.dirty.getEfficiencyRatio(),
      renderDurationMs: endTime - startTime,
      visibleNodes: cullerStats?.visibleNodes ?? this.nodes.size,
      visibleEdges: cullerStats?.visibleEdges ?? this.edges.size,
      cullingEfficiency: cullerStats?.efficiency ?? 0,
    };

    // Clear dirty state
    this.dirty.clear();
  }

  /**
   * Render all nodes (full redraw)
   *
   * @param visibleNodeIds - Optional set of visible node IDs for culling
   */
  private renderAllNodes(visibleNodeIds: Set<string> | null = null): number {
    if (!this.nodeContainer) return 0;

    let count = 0;
    for (const [nodeId, node] of this.nodes) {
      // Skip if culling is enabled and node is not visible
      if (visibleNodeIds !== null && !visibleNodeIds.has(nodeId)) {
        // Hide the node if it was previously rendered
        const rendered = this.renderedNodes.get(nodeId);
        if (rendered) {
          rendered.container.visible = false;
        }
        continue;
      }

      this.renderNode(nodeId, node);
      count++;
    }
    return count;
  }

  /**
   * Render a single node
   */
  private renderNode(nodeId: string, node: GraphNode): void {
    if (!this.nodeContainer) return;

    let rendered = this.renderedNodes.get(nodeId);
    const ontologyClass = node.metadata?.["exo__Instance_class"] as string | undefined;

    if (!rendered) {
      rendered = this.nodeRenderer.createNode(nodeId, ontologyClass, node.label);
      this.nodeContainer.addChild(rendered.container);
      this.renderedNodes.set(nodeId, rendered);
    }

    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const isHovered = this.hoveredNode === nodeId;
    const isSelected = this.selectedNodes.has(nodeId);

    this.nodeRenderer.updateNode(nodeId, x, y, isHovered, isSelected);
  }

  /**
   * Render all edges (full redraw)
   *
   * @param visibleEdgeIds - Optional set of visible edge IDs for culling
   */
  private renderAllEdges(visibleEdgeIds: Set<string> | null = null): number {
    if (!this.edgeContainer) return 0;

    let count = 0;
    for (const [edgeId, edge] of this.edges) {
      // Skip if culling is enabled and edge is not visible
      if (visibleEdgeIds !== null && !visibleEdgeIds.has(edgeId)) {
        // Hide the edge if it was previously rendered
        const rendered = this.renderedEdges.get(edgeId);
        if (rendered) {
          rendered.container.visible = false;
        }
        continue;
      }

      this.renderEdge(edgeId, edge);
      count++;
    }
    return count;
  }

  /**
   * Get endpoint positions for an edge
   */
  private getEdgeEndpoints(sourceNode: GraphNode, targetNode: GraphNode): {
    source: Position;
    target: Position;
  } {
    const sourcePos: Position = {
      x: sourceNode.x ?? 0,
      y: sourceNode.y ?? 0,
    };
    const targetPos: Position = {
      x: targetNode.x ?? 0,
      y: targetNode.y ?? 0,
    };

    const sourceRadius = sourceNode.size ?? 8;
    const targetRadius = targetNode.size ?? 8;

    return calculateEdgeEndpoints(sourcePos, targetPos, sourceRadius, targetRadius);
  }

  /**
   * Render a single edge
   */
  private renderEdge(edgeId: string, edge: GraphEdge): void {
    if (!this.edgeContainer) return;

    const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
    const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

    const sourceNode = this.nodes.get(sourceId);
    const targetNode = this.nodes.get(targetId);

    if (!sourceNode || !targetNode) return;

    const { source, target } = this.getEdgeEndpoints(sourceNode, targetNode);

    let rendered = this.renderedEdges.get(edgeId);
    const predicateType = edge.property;

    if (!rendered) {
      rendered = this.edgeRenderer.createEdge(
        edgeId,
        sourceId,
        targetId,
        source,
        target,
        predicateType
      );
      this.edgeContainer.addChild(rendered.container);
      this.renderedEdges.set(edgeId, rendered);
    } else {
      this.edgeRenderer.updateEdge(edgeId, source, target, false, false);
    }
  }

  /**
   * Render all labels (full redraw)
   *
   * @param visibleNodeIds - Optional set of visible node IDs for culling
   */
  private renderAllLabels(visibleNodeIds: Set<string> | null = null): number {
    if (!this.labelContainer || !this.config.enableLabels) return 0;

    // Check zoom level
    if (this.viewport.zoom < this.config.labelMinZoom ||
        this.viewport.zoom > this.config.labelMaxZoom) {
      return 0;
    }

    let count = 0;
    for (const [nodeId, node] of this.nodes) {
      // Skip if culling is enabled and node is not visible
      if (visibleNodeIds !== null && !visibleNodeIds.has(nodeId)) {
        // Hide the label if it was previously rendered
        const rendered = this.renderedLabels.get(nodeId);
        if (rendered) {
          rendered.container.visible = false;
        }
        continue;
      }

      this.renderLabel(nodeId, node);
      count++;
    }
    return count;
  }

  /**
   * Get label position for a node
   */
  private getLabelPosition(node: GraphNode): Position {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const radius = node.size ?? 8;
    return { x, y: y + radius + 4 };
  }

  /**
   * Render a single label
   */
  private renderLabel(nodeId: string, node: GraphNode): void {
    if (!this.labelContainer) return;

    let rendered = this.renderedLabels.get(nodeId);
    const position = this.getLabelPosition(node);

    if (!rendered) {
      rendered = this.labelRenderer.createLabel(nodeId, node.label);
      this.labelContainer.addChild(rendered.container);
      this.renderedLabels.set(nodeId, rendered);
    }

    this.labelRenderer.updateLabel(nodeId, position, false, false);
  }

  /**
   * Sync nodes (add new, remove old)
   *
   * @param visibleNodeIds - Optional set of visible node IDs for culling
   */
  private syncNodes(visibleNodeIds: Set<string> | null = null): number {
    if (!this.nodeContainer) return 0;

    let count = 0;

    // Remove nodes that no longer exist
    for (const nodeId of this.renderedNodes.keys()) {
      if (!this.nodes.has(nodeId)) {
        const rendered = this.renderedNodes.get(nodeId);
        if (rendered) {
          this.nodeContainer.removeChild(rendered.container);
          this.nodeRenderer.removeNode(nodeId);
          this.renderedNodes.delete(nodeId);
          count++;
        }
      }
    }

    // Add new nodes (respecting visibility culling)
    for (const [nodeId, node] of this.nodes) {
      if (!this.renderedNodes.has(nodeId)) {
        // Skip if culling and not visible
        if (visibleNodeIds !== null && !visibleNodeIds.has(nodeId)) {
          continue;
        }
        this.renderNode(nodeId, node);
        count++;
      }
    }

    return count;
  }

  /**
   * Sync edges (add new, remove old)
   *
   * @param visibleEdgeIds - Optional set of visible edge IDs for culling
   */
  private syncEdges(visibleEdgeIds: Set<string> | null = null): number {
    if (!this.edgeContainer) return 0;

    let count = 0;

    // Remove edges that no longer exist
    for (const edgeId of this.renderedEdges.keys()) {
      if (!this.edges.has(edgeId)) {
        const rendered = this.renderedEdges.get(edgeId);
        if (rendered) {
          this.edgeContainer.removeChild(rendered.container);
          this.edgeRenderer.removeEdge(edgeId);
          this.renderedEdges.delete(edgeId);
          count++;
        }
      }
    }

    // Add new edges (respecting visibility culling)
    for (const [edgeId, edge] of this.edges) {
      if (!this.renderedEdges.has(edgeId)) {
        // Skip if culling and not visible
        if (visibleEdgeIds !== null && !visibleEdgeIds.has(edgeId)) {
          continue;
        }
        this.renderEdge(edgeId, edge);
        count++;
      }
    }

    return count;
  }

  /**
   * Sync labels (add new, remove old)
   *
   * @param visibleNodeIds - Optional set of visible node IDs for culling
   */
  private syncLabels(visibleNodeIds: Set<string> | null = null): number {
    if (!this.labelContainer || !this.config.enableLabels) return 0;

    let count = 0;

    // Remove labels that no longer exist
    for (const nodeId of this.renderedLabels.keys()) {
      if (!this.nodes.has(nodeId)) {
        const rendered = this.renderedLabels.get(nodeId);
        if (rendered) {
          this.labelContainer.removeChild(rendered.container);
          this.labelRenderer.removeLabel(nodeId);
          this.renderedLabels.delete(nodeId);
          count++;
        }
      }
    }

    // Add new labels (respecting visibility culling)
    for (const [nodeId, node] of this.nodes) {
      if (!this.renderedLabels.has(nodeId)) {
        // Skip if culling and not visible
        if (visibleNodeIds !== null && !visibleNodeIds.has(nodeId)) {
          continue;
        }
        this.renderLabel(nodeId, node);
        count++;
      }
    }

    return count;
  }

  /**
   * Update only dirty nodes
   *
   * @param dirtyNodeIds - Set of dirty node IDs
   * @param visibleNodeIds - Optional set of visible node IDs for culling
   */
  private updateDirtyNodes(
    dirtyNodeIds: Set<string>,
    visibleNodeIds: Set<string> | null = null
  ): number {
    let count = 0;

    for (const nodeId of dirtyNodeIds) {
      const node = this.nodes.get(nodeId);
      const rendered = this.renderedNodes.get(nodeId);

      if (node && rendered) {
        // Skip if culling and not visible
        if (visibleNodeIds !== null && !visibleNodeIds.has(nodeId)) {
          rendered.container.visible = false;
          continue;
        }

        // Ensure visible
        rendered.container.visible = true;

        const x = node.x ?? 0;
        const y = node.y ?? 0;
        const isHovered = this.hoveredNode === nodeId;
        const isSelected = this.selectedNodes.has(nodeId);

        this.nodeRenderer.updateNode(nodeId, x, y, isHovered, isSelected);

        // Also update the label position for this node
        const renderedLabel = this.renderedLabels.get(nodeId);
        if (renderedLabel) {
          const position = this.getLabelPosition(node);
          this.labelRenderer.updateLabel(nodeId, position, isHovered, isSelected);
        }

        count++;
      }
    }

    return count;
  }

  /**
   * Update only dirty edges
   *
   * @param dirtyEdgeIds - Set of dirty edge IDs
   * @param visibleEdgeIds - Optional set of visible edge IDs for culling
   */
  private updateDirtyEdges(
    dirtyEdgeIds: Set<string>,
    visibleEdgeIds: Set<string> | null = null
  ): number {
    let count = 0;

    for (const edgeId of dirtyEdgeIds) {
      const edge = this.edges.get(edgeId);
      const rendered = this.renderedEdges.get(edgeId);

      if (edge && rendered) {
        // Skip if culling and not visible
        if (visibleEdgeIds !== null && !visibleEdgeIds.has(edgeId)) {
          rendered.container.visible = false;
          continue;
        }

        // Ensure visible
        rendered.container.visible = true;

        const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
        const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

        const sourceNode = this.nodes.get(sourceId);
        const targetNode = this.nodes.get(targetId);

        if (sourceNode && targetNode) {
          const { source, target } = this.getEdgeEndpoints(sourceNode, targetNode);
          this.edgeRenderer.updateEdge(edgeId, source, target, false, false);
          count++;
        }
      }
    }

    return count;
  }

  /**
   * Update all labels (viewport change)
   *
   * @param visibleNodeIds - Optional set of visible node IDs for culling
   */
  private updateLabels(visibleNodeIds: Set<string> | null = null): number {
    if (!this.config.enableLabels) {
      // Hide all labels
      for (const rendered of this.renderedLabels.values()) {
        rendered.container.visible = false;
      }
      return 0;
    }

    // Check zoom level
    const shouldShow =
      this.viewport.zoom >= this.config.labelMinZoom &&
      this.viewport.zoom <= this.config.labelMaxZoom;

    let count = 0;

    for (const [nodeId, rendered] of this.renderedLabels) {
      // Check visibility culling
      const isCulled = visibleNodeIds !== null && !visibleNodeIds.has(nodeId);
      rendered.container.visible = shouldShow && !isCulled;

      if (shouldShow && !isCulled) {
        const node = this.nodes.get(nodeId);
        if (node) {
          const position = this.getLabelPosition(node);
          const isHovered = this.hoveredNode === nodeId;
          const isSelected = this.selectedNodes.has(nodeId);
          this.labelRenderer.updateLabel(nodeId, position, isHovered, isSelected);
          count++;
        }
      }
    }

    return count;
  }

  /**
   * Update all node styles
   */
  private updateAllNodeStyles(): number {
    let count = 0;

    for (const [nodeId, node] of this.nodes) {
      const ontologyClass = node.metadata?.["exo__Instance_class"] as string | undefined;
      this.nodeRenderer.updateNodeStyle(nodeId, ontologyClass);
      count++;
    }

    return count;
  }

  /**
   * Update all edge styles
   */
  private updateAllEdgeStyles(): number {
    let count = 0;

    for (const [edgeId, edge] of this.edges) {
      const predicateType = edge.property;
      this.edgeRenderer.updateEdgeStyle(edgeId, predicateType);
      count++;
    }

    return count;
  }

  /**
   * Clear all rendered elements
   */
  clear(): void {
    // Clear nodes
    for (const nodeId of this.renderedNodes.keys()) {
      this.nodeRenderer.removeNode(nodeId);
    }
    this.renderedNodes.clear();

    // Clear edges
    for (const edgeId of this.renderedEdges.keys()) {
      this.edgeRenderer.removeEdge(edgeId);
    }
    this.renderedEdges.clear();

    // Clear labels
    for (const nodeId of this.renderedLabels.keys()) {
      this.labelRenderer.removeLabel(nodeId);
    }
    this.renderedLabels.clear();

    // Clear data
    this.nodes.clear();
    this.edges.clear();
    this.edgeIndex.clear();

    // Clear visibility culler
    this.culler.clear();

    // Clear dirty state
    this.dirty.clear();
  }

  /**
   * Destroy the renderer and release resources
   */
  destroy(): void {
    this.clear();
    this.nodeRenderer.destroy();
    this.edgeRenderer.destroy();
    this.labelRenderer.destroy();
  }

  /**
   * Get render statistics
   */
  getStats(): RenderStats {
    return { ...this.lastStats };
  }

  /**
   * Get dirty tracker for direct manipulation if needed
   */
  getDirtyTracker(): DirtyTracker {
    return this.dirty;
  }

  /**
   * Get the edge index for external use
   */
  getEdgeIndex(): NodeEdgeIndex {
    return this.edgeIndex;
  }

  /**
   * Force a full redraw on next render
   */
  forceFullRedraw(): void {
    this.dirty.markDirty("all");
  }

  /**
   * Check if any updates are pending
   */
  hasPendingUpdates(): boolean {
    return this.dirty.hasAnyDirty();
  }

  /**
   * Get the visibility culler for external use
   */
  getVisibilityCuller(): VisibilityCuller {
    return this.culler;
  }

  /**
   * Enable or disable visibility culling
   *
   * @param enabled - Whether to enable culling
   */
  setCullingEnabled(enabled: boolean): void {
    this.config.enableCulling = enabled;
    if (!enabled) {
      // Make all elements visible when culling is disabled
      for (const rendered of this.renderedNodes.values()) {
        rendered.container.visible = true;
      }
      for (const rendered of this.renderedEdges.values()) {
        rendered.container.visible = true;
      }
    }
  }

  /**
   * Check if visibility culling is enabled
   */
  isCullingEnabled(): boolean {
    return this.config.enableCulling;
  }
}

/**
 * HoverManager - Node and edge hover state management with tooltip support
 *
 * Provides comprehensive hover feedback for graph visualization:
 * - Immediate visual feedback on hover (highlight, glow effects)
 * - Delayed tooltip display with configurable delay
 * - Connected edge highlighting on node hover
 * - Edge hover with source/target node highlighting
 * - Tooltip data fetching from triple store
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import type { GraphNode, GraphEdge } from "./types";

/**
 * Point coordinates in screen space
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Hover state containing current hover targets
 */
export interface HoverState {
  /** Currently hovered node ID (or null) */
  nodeId: string | null;
  /** Currently hovered edge ID (or null) */
  edgeId: string | null;
  /** Cursor position in screen coordinates */
  position: Point;
  /** Timestamp when hover started */
  enterTime: number;
  /** Whether the tooltip is currently visible */
  isTooltipVisible: boolean;
}

/**
 * Node type classification for styling
 */
export type NodeType =
  | "task"
  | "project"
  | "area"
  | "person"
  | "concept"
  | "asset"
  | "unknown";

/**
 * Property value for tooltip display
 */
export interface PropertyValue {
  /** Property name */
  name: string;
  /** Property value */
  value: string;
  /** Property URI (for clicking) */
  uri?: string;
}

/**
 * Data structure for tooltip content
 */
export interface TooltipData {
  /** Node/edge ID */
  id: string;
  /** Display title */
  title: string;
  /** Node type for styling */
  type: NodeType;
  /** Properties to display */
  properties: PropertyValue[];
  /** Count of incoming edges */
  incomingCount: number;
  /** Count of outgoing edges */
  outgoingCount: number;
  /** Preview text content */
  preview?: string;
  /** Thumbnail image URL */
  thumbnail?: string;
  /** File path for navigation */
  path?: string;
}

/**
 * Provider interface for tooltip data
 */
export interface TooltipDataProvider {
  /**
   * Get tooltip data for a node or edge
   *
   * @param id - Node or edge ID
   * @param type - Whether it's a node or edge
   * @returns Promise resolving to tooltip data
   */
  getTooltipData(id: string, type: "node" | "edge"): Promise<TooltipData>;
}

/**
 * Renderer interface for tooltip display
 */
export interface TooltipRenderer {
  /**
   * Show tooltip at position
   *
   * @param data - Tooltip data to display
   * @param position - Screen position for tooltip
   */
  show(data: TooltipData, position: Point): void;

  /**
   * Hide the tooltip
   */
  hide(): void;

  /**
   * Update tooltip position
   *
   * @param position - New screen position
   */
  updatePosition(position: Point): void;

  /**
   * Check if tooltip is visible
   */
  isVisible(): boolean;

  /**
   * Destroy the renderer
   */
  destroy(): void;
}

/**
 * Configuration for HoverManager
 */
export interface HoverManagerConfig {
  /** Delay in ms before showing tooltip (default: 300) */
  hoverDelay: number;
  /** Whether to highlight connected edges on node hover (default: true) */
  highlightConnectedEdges: boolean;
  /** Whether to highlight source/target nodes on edge hover (default: true) */
  highlightConnectedNodes: boolean;
  /** Opacity for non-highlighted elements when something is hovered (default: 0.3) */
  dimmedOpacity: number;
  /** Glow color for highlighted nodes (hex, default: 0x6366f1) */
  glowColor: number;
  /** Glow blur radius (default: 10) */
  glowBlur: number;
  /** Enable tooltips (default: true) */
  tooltipsEnabled: boolean;
}

/**
 * Event types emitted by HoverManager
 */
export type HoverEventType =
  | "hover:node:enter"
  | "hover:node:leave"
  | "hover:edge:enter"
  | "hover:edge:leave"
  | "hover:tooltip:show"
  | "hover:tooltip:hide"
  | "hover:highlight:change";

/**
 * Event data for hover events
 */
export interface HoverEvent {
  type: HoverEventType;
  /** Currently hovered node ID */
  nodeId: string | null;
  /** Currently hovered edge ID */
  edgeId: string | null;
  /** Screen position */
  position: Point;
  /** Set of highlighted node IDs */
  highlightedNodeIds: Set<string>;
  /** Set of highlighted edge IDs */
  highlightedEdgeIds: Set<string>;
  /** Tooltip data (if tooltip event) */
  tooltipData?: TooltipData;
}

/**
 * Event listener callback type
 */
export type HoverEventListener = (event: HoverEvent) => void;

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: HoverManagerConfig = {
  hoverDelay: 300,
  highlightConnectedEdges: true,
  highlightConnectedNodes: true,
  dimmedOpacity: 0.3,
  glowColor: 0x6366f1,
  glowBlur: 10,
  tooltipsEnabled: true,
};

/**
 * HoverManager class for handling hover interactions
 *
 * @example
 * ```typescript
 * const hover = new HoverManager({
 *   dataProvider: myTooltipDataProvider,
 *   renderer: myTooltipRenderer,
 * });
 *
 * hover.on("hover:node:enter", (event) => {
 *   console.log("Hovered node:", event.nodeId);
 * });
 *
 * hover.on("hover:highlight:change", (event) => {
 *   // Update rendering to highlight nodes/edges
 *   redrawNodes(event.highlightedNodeIds);
 *   redrawEdges(event.highlightedEdgeIds);
 * });
 *
 * // Handle mouse events
 * hover.onNodeEnter("node1", { x: 100, y: 100 });
 * hover.onNodeLeave();
 *
 * // Cleanup
 * hover.destroy();
 * ```
 */
export class HoverManager {
  private state: HoverState;
  private config: HoverManagerConfig;
  private edges: GraphEdge[] = [];

  // Node lookup map for O(1) access by ID
  private nodeMap: Map<string, GraphNode> = new Map();

  // Timer for delayed tooltip
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;

  // Data provider and renderer
  private dataProvider: TooltipDataProvider | null = null;
  private renderer: TooltipRenderer | null = null;

  // Highlighted items
  private highlightedNodeIds: Set<string> = new Set();
  private highlightedEdgeIds: Set<string> = new Set();

  // Edge lookup maps for efficient connected node/edge finding
  private nodeToEdges: Map<string, GraphEdge[]> = new Map();

  // Event listeners
  private listeners: Map<HoverEventType, Set<HoverEventListener>> = new Map();

  constructor(options?: {
    config?: Partial<HoverManagerConfig>;
    dataProvider?: TooltipDataProvider;
    renderer?: TooltipRenderer;
  }) {
    this.config = { ...DEFAULT_CONFIG, ...options?.config };
    this.dataProvider = options?.dataProvider ?? null;
    this.renderer = options?.renderer ?? null;

    this.state = {
      nodeId: null,
      edgeId: null,
      position: { x: 0, y: 0 },
      enterTime: 0,
      isTooltipVisible: false,
    };
  }

  /**
   * Set the nodes array and build lookup map
   *
   * @param nodes - Array of graph nodes
   */
  setNodes(nodes: GraphNode[]): void {
    this.nodeMap.clear();
    for (const node of nodes) {
      this.nodeMap.set(node.id, node);
    }
  }

  /**
   * Get a node by ID
   *
   * @param id - Node ID
   * @returns GraphNode or undefined if not found
   */
  getNode(id: string): GraphNode | undefined {
    return this.nodeMap.get(id);
  }

  /**
   * Set the edges array and build lookup maps
   *
   * @param edges - Array of graph edges
   */
  setEdges(edges: GraphEdge[]): void {
    this.edges = edges;
    this.buildEdgeLookup();
  }

  /**
   * Set the tooltip data provider
   *
   * @param provider - Data provider implementation
   */
  setDataProvider(provider: TooltipDataProvider): void {
    this.dataProvider = provider;
  }

  /**
   * Set the tooltip renderer
   *
   * @param renderer - Tooltip renderer implementation
   */
  setRenderer(renderer: TooltipRenderer): void {
    this.renderer = renderer;
  }

  /**
   * Build edge lookup maps for efficient connected node/edge finding
   */
  private buildEdgeLookup(): void {
    this.nodeToEdges.clear();

    for (const edge of this.edges) {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

      // Add to source node's edges
      let sourceEdges = this.nodeToEdges.get(sourceId);
      if (!sourceEdges) {
        sourceEdges = [];
        this.nodeToEdges.set(sourceId, sourceEdges);
      }
      sourceEdges.push(edge);

      // Add to target node's edges
      let targetEdges = this.nodeToEdges.get(targetId);
      if (!targetEdges) {
        targetEdges = [];
        this.nodeToEdges.set(targetId, targetEdges);
      }
      targetEdges.push(edge);
    }
  }

  /**
   * Get edges connected to a node
   */
  private getConnectedEdges(nodeId: string): GraphEdge[] {
    return this.nodeToEdges.get(nodeId) ?? [];
  }

  /**
   * Get nodes connected to an edge
   */
  private getConnectedNodes(edge: GraphEdge): string[] {
    const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
    const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;
    return [sourceId, targetId];
  }

  /**
   * Handle node hover enter
   *
   * @param nodeId - ID of the hovered node
   * @param screenPos - Screen position of the cursor
   */
  onNodeEnter(nodeId: string, screenPos: Point): void {
    // Ignore if already hovering this node
    if (this.state.nodeId === nodeId) {
      // Update position for tooltip tracking
      this.state.position = screenPos;
      if (this.renderer && this.state.isTooltipVisible) {
        this.renderer.updatePosition(screenPos);
      }
      return;
    }

    // Clear any existing hover state
    this.clearHoverTimer();
    this.hideTooltip();

    // Update state
    this.state = {
      nodeId,
      edgeId: null,
      position: screenPos,
      enterTime: performance.now(),
      isTooltipVisible: false,
    };

    // Immediate visual feedback - highlight node and connected edges
    this.updateHighlights();

    // Emit enter event
    this.emit({
      type: "hover:node:enter",
      nodeId,
      edgeId: null,
      position: screenPos,
      highlightedNodeIds: new Set(this.highlightedNodeIds),
      highlightedEdgeIds: new Set(this.highlightedEdgeIds),
    });

    // Schedule delayed tooltip
    if (this.config.tooltipsEnabled) {
      this.hoverTimer = setTimeout(() => {
        this.showTooltip(nodeId, "node");
      }, this.config.hoverDelay);
    }
  }

  /**
   * Handle node hover leave
   */
  onNodeLeave(): void {
    if (this.state.nodeId === null) return;

    const previousNodeId = this.state.nodeId;

    this.clearHoverTimer();
    this.hideTooltip();

    // Clear state
    this.state.nodeId = null;

    // Clear highlights
    this.clearHighlights();

    // Emit leave event
    this.emit({
      type: "hover:node:leave",
      nodeId: previousNodeId,
      edgeId: null,
      position: this.state.position,
      highlightedNodeIds: new Set(),
      highlightedEdgeIds: new Set(),
    });
  }

  /**
   * Handle edge hover enter
   *
   * @param edgeId - ID of the hovered edge
   * @param screenPos - Screen position of the cursor
   */
  onEdgeEnter(edgeId: string, screenPos: Point): void {
    // Ignore if already hovering this edge
    if (this.state.edgeId === edgeId) {
      this.state.position = screenPos;
      if (this.renderer && this.state.isTooltipVisible) {
        this.renderer.updatePosition(screenPos);
      }
      return;
    }

    // Clear any existing hover state
    this.clearHoverTimer();
    this.hideTooltip();

    // Update state
    this.state = {
      nodeId: null,
      edgeId,
      position: screenPos,
      enterTime: performance.now(),
      isTooltipVisible: false,
    };

    // Immediate visual feedback - highlight edge and connected nodes
    this.updateHighlights();

    // Emit enter event
    this.emit({
      type: "hover:edge:enter",
      nodeId: null,
      edgeId,
      position: screenPos,
      highlightedNodeIds: new Set(this.highlightedNodeIds),
      highlightedEdgeIds: new Set(this.highlightedEdgeIds),
    });

    // Schedule delayed tooltip
    if (this.config.tooltipsEnabled) {
      this.hoverTimer = setTimeout(() => {
        this.showTooltip(edgeId, "edge");
      }, this.config.hoverDelay);
    }
  }

  /**
   * Handle edge hover leave
   */
  onEdgeLeave(): void {
    if (this.state.edgeId === null) return;

    const previousEdgeId = this.state.edgeId;

    this.clearHoverTimer();
    this.hideTooltip();

    // Clear state
    this.state.edgeId = null;

    // Clear highlights
    this.clearHighlights();

    // Emit leave event
    this.emit({
      type: "hover:edge:leave",
      nodeId: null,
      edgeId: previousEdgeId,
      position: this.state.position,
      highlightedNodeIds: new Set(),
      highlightedEdgeIds: new Set(),
    });
  }

  /**
   * Update cursor position (for tooltip tracking)
   *
   * @param screenPos - New screen position
   */
  updatePosition(screenPos: Point): void {
    this.state.position = screenPos;

    if (this.renderer && this.state.isTooltipVisible) {
      this.renderer.updatePosition(screenPos);
    }
  }

  /**
   * Update highlighted nodes and edges based on current hover state
   */
  private updateHighlights(): void {
    this.highlightedNodeIds.clear();
    this.highlightedEdgeIds.clear();

    if (this.state.nodeId) {
      // Highlight the hovered node
      this.highlightedNodeIds.add(this.state.nodeId);

      // Highlight connected edges
      if (this.config.highlightConnectedEdges) {
        const connectedEdges = this.getConnectedEdges(this.state.nodeId);
        for (const edge of connectedEdges) {
          this.highlightedEdgeIds.add(edge.id);

          // Also highlight connected nodes
          if (this.config.highlightConnectedNodes) {
            const connectedNodes = this.getConnectedNodes(edge);
            for (const nodeId of connectedNodes) {
              this.highlightedNodeIds.add(nodeId);
            }
          }
        }
      }
    }

    if (this.state.edgeId) {
      // Highlight the hovered edge
      this.highlightedEdgeIds.add(this.state.edgeId);

      // Highlight connected nodes
      if (this.config.highlightConnectedNodes) {
        const edge = this.edges.find((e) => e.id === this.state.edgeId);
        if (edge) {
          const connectedNodes = this.getConnectedNodes(edge);
          for (const nodeId of connectedNodes) {
            this.highlightedNodeIds.add(nodeId);
          }
        }
      }
    }

    // Emit highlight change event
    this.emit({
      type: "hover:highlight:change",
      nodeId: this.state.nodeId,
      edgeId: this.state.edgeId,
      position: this.state.position,
      highlightedNodeIds: new Set(this.highlightedNodeIds),
      highlightedEdgeIds: new Set(this.highlightedEdgeIds),
    });
  }

  /**
   * Clear all highlights
   */
  private clearHighlights(): void {
    if (this.highlightedNodeIds.size === 0 && this.highlightedEdgeIds.size === 0) {
      return;
    }

    this.highlightedNodeIds.clear();
    this.highlightedEdgeIds.clear();

    // Emit highlight change event
    this.emit({
      type: "hover:highlight:change",
      nodeId: null,
      edgeId: null,
      position: this.state.position,
      highlightedNodeIds: new Set(),
      highlightedEdgeIds: new Set(),
    });
  }

  /**
   * Clear the hover timer
   */
  private clearHoverTimer(): void {
    if (this.hoverTimer !== null) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
  }

  /**
   * Show tooltip for the given ID
   */
  private async showTooltip(id: string, type: "node" | "edge"): Promise<void> {
    if (!this.dataProvider || !this.renderer) {
      return;
    }

    // Verify we're still hovering the same item
    if (type === "node" && this.state.nodeId !== id) {
      return;
    }
    if (type === "edge" && this.state.edgeId !== id) {
      return;
    }

    try {
      const data = await this.dataProvider.getTooltipData(id, type);

      // Verify we're still hovering the same item after async fetch
      if (type === "node" && this.state.nodeId !== id) {
        return;
      }
      if (type === "edge" && this.state.edgeId !== id) {
        return;
      }

      this.renderer.show(data, this.state.position);
      this.state.isTooltipVisible = true;

      // Emit tooltip show event
      this.emit({
        type: "hover:tooltip:show",
        nodeId: this.state.nodeId,
        edgeId: this.state.edgeId,
        position: this.state.position,
        highlightedNodeIds: new Set(this.highlightedNodeIds),
        highlightedEdgeIds: new Set(this.highlightedEdgeIds),
        tooltipData: data,
      });
    } catch (error) {
      // Silently fail if tooltip data fetch fails
      console.warn("Failed to fetch tooltip data:", error);
    }
  }

  /**
   * Hide the tooltip
   */
  private hideTooltip(): void {
    if (!this.state.isTooltipVisible) {
      return;
    }

    if (this.renderer) {
      this.renderer.hide();
    }

    this.state.isTooltipVisible = false;

    // Emit tooltip hide event
    this.emit({
      type: "hover:tooltip:hide",
      nodeId: this.state.nodeId,
      edgeId: this.state.edgeId,
      position: this.state.position,
      highlightedNodeIds: new Set(this.highlightedNodeIds),
      highlightedEdgeIds: new Set(this.highlightedEdgeIds),
    });
  }

  /**
   * Check if a node is highlighted
   */
  isNodeHighlighted(nodeId: string): boolean {
    return this.highlightedNodeIds.has(nodeId);
  }

  /**
   * Check if an edge is highlighted
   */
  isEdgeHighlighted(edgeId: string): boolean {
    return this.highlightedEdgeIds.has(edgeId);
  }

  /**
   * Check if any node or edge is hovered
   */
  isHovering(): boolean {
    return this.state.nodeId !== null || this.state.edgeId !== null;
  }

  /**
   * Check if tooltip is currently visible
   */
  isTooltipVisible(): boolean {
    return this.state.isTooltipVisible;
  }

  /**
   * Get the current hover state
   */
  getHoverState(): HoverState {
    return { ...this.state };
  }

  /**
   * Get the set of highlighted node IDs
   */
  getHighlightedNodeIds(): Set<string> {
    return new Set(this.highlightedNodeIds);
  }

  /**
   * Get the set of highlighted edge IDs
   */
  getHighlightedEdgeIds(): Set<string> {
    return new Set(this.highlightedEdgeIds);
  }

  /**
   * Get the dimmed opacity for non-highlighted elements
   */
  getDimmedOpacity(): number {
    return this.config.dimmedOpacity;
  }

  /**
   * Get the glow configuration
   */
  getGlowConfig(): { color: number; blur: number } {
    return {
      color: this.config.glowColor,
      blur: this.config.glowBlur,
    };
  }

  /**
   * Add event listener
   *
   * @param type - Event type to listen for
   * @param listener - Callback function
   */
  on(type: HoverEventType, listener: HoverEventListener): void {
    let typeListeners = this.listeners.get(type);
    if (!typeListeners) {
      typeListeners = new Set();
      this.listeners.set(type, typeListeners);
    }
    typeListeners.add(listener);
  }

  /**
   * Remove event listener
   *
   * @param type - Event type
   * @param listener - Callback function to remove
   */
  off(type: HoverEventType, listener: HoverEventListener): void {
    const typeListeners = this.listeners.get(type);
    if (typeListeners) {
      typeListeners.delete(listener);
    }
  }

  /**
   * Emit an event to all registered listeners
   */
  private emit(event: HoverEvent): void {
    const typeListeners = this.listeners.get(event.type);
    if (typeListeners) {
      for (const listener of typeListeners) {
        listener(event);
      }
    }
  }

  /**
   * Update configuration
   *
   * @param config - Partial configuration to merge
   */
  setConfig(config: Partial<HoverManagerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): HoverManagerConfig {
    return { ...this.config };
  }

  /**
   * Destroy the hover manager and release resources
   */
  destroy(): void {
    this.clearHoverTimer();
    this.hideTooltip();

    if (this.renderer) {
      this.renderer.destroy();
    }

    this.state = {
      nodeId: null,
      edgeId: null,
      position: { x: 0, y: 0 },
      enterTime: 0,
      isTooltipVisible: false,
    };

    this.highlightedNodeIds.clear();
    this.highlightedEdgeIds.clear();
    this.nodeToEdges.clear();
    this.nodeMap.clear();
    this.listeners.clear();
    this.edges = [];
    this.dataProvider = null;
    this.renderer = null;
  }
}

/**
 * Default HoverManager configuration
 */
export const DEFAULT_HOVER_MANAGER_CONFIG = DEFAULT_CONFIG;

/**
 * VirtualCursor - Screen reader-friendly virtual cursor for graph navigation
 *
 * Provides virtual cursor navigation for screen reader users:
 * - Spatial navigation (arrow keys find nearest node in direction)
 * - Linear navigation (Tab/Shift+Tab through nodes in order)
 * - Semantic navigation (navigate by node type or relationship)
 * - History navigation (back/forward through visited nodes)
 *
 * @module presentation/renderers/graph/accessibility
 * @since 1.0.0
 */

import type { GraphNode as GraphNodeData } from "../types";
import type {
  A11yNode,
  A11yNavigationDirection,
  VirtualCursorMode,
  VirtualCursorState,
} from "./AccessibilityTypes";

/**
 * Configuration for VirtualCursor
 */
export interface VirtualCursorConfig {
  /** Maximum history size (default: 50) */
  maxHistorySize: number;
  /** Wrap around when reaching end (default: true) */
  wrapAround: boolean;
  /** Default navigation mode (default: 'spatial') */
  defaultMode: VirtualCursorMode;
  /** Angular tolerance for directional navigation in degrees (default: 45) */
  directionTolerance: number;
  /** Callback when cursor position changes */
  onPositionChange?: (nodeId: string | null, previousNodeId: string | null) => void;
  /** Callback when mode changes */
  onModeChange?: (mode: VirtualCursorMode) => void;
}

/**
 * Navigation result
 */
export interface VirtualCursorNavigationResult {
  /** Whether navigation was successful */
  success: boolean;
  /** New node ID if successful */
  nodeId: string | null;
  /** Previous node ID */
  previousNodeId: string | null;
  /** Direction of navigation */
  direction: A11yNavigationDirection;
  /** Mode used for navigation */
  mode: VirtualCursorMode;
}

/**
 * Event types for VirtualCursor
 */
export type VirtualCursorEventType =
  | "cursor:move"
  | "cursor:mode:change"
  | "cursor:activate"
  | "cursor:deactivate";

/**
 * Event data for VirtualCursor
 */
export interface VirtualCursorEvent {
  type: VirtualCursorEventType;
  nodeId?: string | null;
  previousNodeId?: string | null;
  mode?: VirtualCursorMode;
  direction?: A11yNavigationDirection;
}

/**
 * Event listener type
 */
export type VirtualCursorEventListener = (event: VirtualCursorEvent) => void;

/**
 * Default configuration
 */
export const DEFAULT_VIRTUAL_CURSOR_CONFIG: VirtualCursorConfig = {
  maxHistorySize: 50,
  wrapAround: true,
  defaultMode: "spatial",
  directionTolerance: 45,
};

/**
 * VirtualCursor class for accessible graph navigation
 *
 * @example
 * ```typescript
 * const cursor = new VirtualCursor();
 * cursor.setNodes(graphNodes);
 *
 * // Spatial navigation
 * cursor.navigate('right'); // Move to nearest node to the right
 *
 * // Linear navigation
 * cursor.navigate('next'); // Move to next node in order
 *
 * // Semantic navigation
 * cursor.setMode('semantic');
 * cursor.navigateToType('Task'); // Move to next Task node
 *
 * // History navigation
 * cursor.goBack();
 * cursor.goForward();
 * ```
 */
export class VirtualCursor {
  private config: VirtualCursorConfig;
  private state: VirtualCursorState;
  private nodes: GraphNodeData[] = [];
  private a11yNodes: Map<string, A11yNode> = new Map();
  private listeners: Map<VirtualCursorEventType, Set<VirtualCursorEventListener>> = new Map();

  constructor(config?: Partial<VirtualCursorConfig>) {
    this.config = { ...DEFAULT_VIRTUAL_CURSOR_CONFIG, ...config };
    this.state = {
      currentNodeId: null,
      previousNodeId: null,
      history: [],
      historyIndex: -1,
      mode: this.config.defaultMode,
      isActive: false,
    };
  }

  /**
   * Set the nodes for navigation
   */
  setNodes(nodes: GraphNodeData[]): void {
    this.nodes = nodes;
    this.buildA11yNodes();
  }

  /**
   * Build accessible node representations
   */
  private buildA11yNodes(): void {
    this.a11yNodes.clear();

    // Build adjacency map for connection counting
    const connections = new Map<string, Set<string>>();
    for (const node of this.nodes) {
      connections.set(node.id, new Set());
    }

    // Count connections (this would need edge data in real implementation)
    // For now, we just initialize empty connection sets

    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      const connectedNodes = connections.get(node.id) ?? new Set();

      const a11yNode: A11yNode = {
        id: node.id,
        label: node.label || node.id,
        type: node.group || "Node",
        connectionCount: connectedNodes.size,
        connectedTo: Array.from(connectedNodes),
        position: { x: node.x ?? 0, y: node.y ?? 0 },
        index: i,
        isSelected: false,
        isFocused: this.state.currentNodeId === node.id,
        metadata: node.metadata,
      };

      this.a11yNodes.set(node.id, a11yNode);
    }
  }

  /**
   * Update connection information from edges
   */
  updateConnections(edges: Array<{ source: string; target: string; label?: string }>): void {
    const connections = new Map<string, string[]>();

    for (const node of this.nodes) {
      connections.set(node.id, []);
    }

    for (const edge of edges) {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target;

      connections.get(sourceId)?.push(targetId);
      connections.get(targetId)?.push(sourceId);
    }

    for (const [nodeId, connectedIds] of connections) {
      const a11yNode = this.a11yNodes.get(nodeId);
      if (a11yNode) {
        a11yNode.connectionCount = connectedIds.length;
        a11yNode.connectedTo = connectedIds.map((id) => {
          const node = this.a11yNodes.get(id);
          return node?.label || id;
        });
      }
    }
  }

  /**
   * Get current navigation mode
   */
  getMode(): VirtualCursorMode {
    return this.state.mode;
  }

  /**
   * Set navigation mode
   */
  setMode(mode: VirtualCursorMode): void {
    this.state.mode = mode;

    this.config.onModeChange?.(mode);

    this.emit({
      type: "cursor:mode:change",
      mode,
    });
  }

  /**
   * Get current cursor position (node ID)
   */
  getCurrentNodeId(): string | null {
    return this.state.currentNodeId;
  }

  /**
   * Get current node's accessibility info
   */
  getCurrentNode(): A11yNode | null {
    if (!this.state.currentNodeId) return null;
    return this.a11yNodes.get(this.state.currentNodeId) ?? null;
  }

  /**
   * Get all accessible nodes
   */
  getA11yNodes(): A11yNode[] {
    return Array.from(this.a11yNodes.values());
  }

  /**
   * Set cursor position directly
   */
  setPosition(nodeId: string | null): void {
    if (nodeId === this.state.currentNodeId) return;

    const previousNodeId = this.state.currentNodeId;
    this.state.previousNodeId = previousNodeId;
    this.state.currentNodeId = nodeId;

    // Update focus state in a11y nodes
    if (previousNodeId) {
      const prevNode = this.a11yNodes.get(previousNodeId);
      if (prevNode) prevNode.isFocused = false;
    }
    if (nodeId) {
      const currNode = this.a11yNodes.get(nodeId);
      if (currNode) currNode.isFocused = true;
    }

    // Add to history
    if (nodeId) {
      this.addToHistory(nodeId);
    }

    this.config.onPositionChange?.(nodeId, previousNodeId);

    this.emit({
      type: "cursor:move",
      nodeId,
      previousNodeId,
    });
  }

  /**
   * Navigate in a direction
   */
  navigate(direction: A11yNavigationDirection): VirtualCursorNavigationResult {
    const previousNodeId = this.state.currentNodeId;
    let newNodeId: string | null = null;

    switch (this.state.mode) {
      case "spatial":
        newNodeId = this.navigateSpatial(direction);
        break;
      case "linear":
        newNodeId = this.navigateLinear(direction);
        break;
      case "semantic":
        newNodeId = this.navigateLinear(direction); // Default to linear for semantic
        break;
    }

    if (newNodeId !== null && newNodeId !== previousNodeId) {
      this.setPosition(newNodeId);
      return {
        success: true,
        nodeId: newNodeId,
        previousNodeId,
        direction,
        mode: this.state.mode,
      };
    }

    return {
      success: false,
      nodeId: this.state.currentNodeId,
      previousNodeId,
      direction,
      mode: this.state.mode,
    };
  }

  /**
   * Navigate spatially (nearest node in direction)
   */
  private navigateSpatial(direction: A11yNavigationDirection): string | null {
    if (this.nodes.length === 0) return null;

    // Handle non-directional navigation
    switch (direction) {
      case "first":
        return this.nodes[0]?.id ?? null;
      case "last":
        return this.nodes[this.nodes.length - 1]?.id ?? null;
      case "next":
        return this.navigateLinear("next");
      case "previous":
        return this.navigateLinear("previous");
    }

    // If no current position, start at first node
    if (!this.state.currentNodeId) {
      return this.nodes[0]?.id ?? null;
    }

    const currentNode = this.nodes.find((n) => n.id === this.state.currentNodeId);
    if (!currentNode) return null;

    const currentX = currentNode.x ?? 0;
    const currentY = currentNode.y ?? 0;

    // Direction vectors
    // Note: parent/child semantic directions map to up/down for spatial navigation
    const dirVectors: Record<string, { x: number; y: number }> = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
      parent: { x: 0, y: -1 },
      child: { x: 0, y: 1 },
    };

    const dirVector = dirVectors[direction];
    if (!dirVector) return null;

    // Find nodes in the direction
    const toleranceRad = (this.config.directionTolerance * Math.PI) / 180;
    let bestNode: GraphNodeData | null = null;
    let bestScore = Infinity;

    for (const node of this.nodes) {
      if (node.id === currentNode.id) continue;

      const nodeX = node.x ?? 0;
      const nodeY = node.y ?? 0;
      const dx = nodeX - currentX;
      const dy = nodeY - currentY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance === 0) continue;

      // Calculate angle to node
      const angle = Math.atan2(dy, dx);
      const targetAngle = Math.atan2(dirVector.y, dirVector.x);
      let angleDiff = Math.abs(angle - targetAngle);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

      // Check if node is within tolerance cone
      if (angleDiff <= toleranceRad) {
        // Score by distance, with penalty for angle deviation
        const score = distance * (1 + angleDiff);
        if (score < bestScore) {
          bestScore = score;
          bestNode = node;
        }
      }
    }

    // If no node found in direction and wrap is enabled, wrap to opposite side
    if (!bestNode && this.config.wrapAround) {
      // Find node on opposite edge
      // Note: parent/child semantic directions map to up/down for wrap purposes
      const oppositeDirMap: Record<string, string> = {
        up: "down",
        down: "up",
        left: "right",
        right: "left",
        parent: "down",
        child: "up",
      };
      const oppositeDir = oppositeDirMap[direction];

      if (oppositeDir) {
        // Find furthest node in opposite direction as wrap target
        let furthest: GraphNodeData | null = null;
        let maxDist = -Infinity;

        for (const node of this.nodes) {
          if (node.id === currentNode.id) continue;

          const nodeX = node.x ?? 0;
          const nodeY = node.y ?? 0;
          const dx = nodeX - currentX;
          const dy = nodeY - currentY;

          // Check if in opposite direction
          const dotProduct = dx * -dirVector.x + dy * -dirVector.y;
          if (dotProduct > 0) {
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > maxDist) {
              maxDist = distance;
              furthest = node;
            }
          }
        }

        bestNode = furthest;
      }
    }

    return bestNode?.id ?? null;
  }

  /**
   * Navigate linearly (next/previous in order)
   */
  private navigateLinear(direction: A11yNavigationDirection): string | null {
    if (this.nodes.length === 0) return null;

    // Handle non-linear directions
    switch (direction) {
      case "first":
        return this.nodes[0]?.id ?? null;
      case "last":
        return this.nodes[this.nodes.length - 1]?.id ?? null;
      case "up":
      case "left":
      case "previous":
        // Navigate to previous
        break;
      case "down":
      case "right":
      case "next":
        // Navigate to next
        break;
      default:
        return null;
    }

    // If no current position, start at first node
    if (!this.state.currentNodeId) {
      return this.nodes[0]?.id ?? null;
    }

    const currentIndex = this.nodes.findIndex((n) => n.id === this.state.currentNodeId);
    if (currentIndex === -1) return this.nodes[0]?.id ?? null;

    const isForward = direction === "next" || direction === "down" || direction === "right";
    let newIndex: number;

    if (isForward) {
      newIndex = currentIndex + 1;
      if (newIndex >= this.nodes.length) {
        newIndex = this.config.wrapAround ? 0 : this.nodes.length - 1;
      }
    } else {
      newIndex = currentIndex - 1;
      if (newIndex < 0) {
        newIndex = this.config.wrapAround ? this.nodes.length - 1 : 0;
      }
    }

    return this.nodes[newIndex]?.id ?? null;
  }

  /**
   * Navigate to a specific node type (semantic navigation)
   */
  navigateToType(type: string, forward: boolean = true): VirtualCursorNavigationResult {
    const typedNodes = this.nodes.filter((n) => n.group === type);
    if (typedNodes.length === 0) {
      return {
        success: false,
        nodeId: this.state.currentNodeId,
        previousNodeId: this.state.previousNodeId,
        direction: forward ? "next" : "previous",
        mode: "semantic",
      };
    }

    const currentIndex = this.state.currentNodeId
      ? typedNodes.findIndex((n) => n.id === this.state.currentNodeId)
      : -1;

    let newIndex: number;
    if (forward) {
      newIndex = currentIndex + 1;
      if (newIndex >= typedNodes.length) {
        newIndex = this.config.wrapAround ? 0 : typedNodes.length - 1;
      }
    } else {
      newIndex = currentIndex - 1;
      if (newIndex < 0) {
        newIndex = this.config.wrapAround ? typedNodes.length - 1 : 0;
      }
    }

    const targetNode = typedNodes[newIndex];
    if (targetNode && targetNode.id !== this.state.currentNodeId) {
      this.setPosition(targetNode.id);
      return {
        success: true,
        nodeId: targetNode.id,
        previousNodeId: this.state.previousNodeId,
        direction: forward ? "next" : "previous",
        mode: "semantic",
      };
    }

    return {
      success: false,
      nodeId: this.state.currentNodeId,
      previousNodeId: this.state.previousNodeId,
      direction: forward ? "next" : "previous",
      mode: "semantic",
    };
  }

  /**
   * Navigate to a connected node
   */
  navigateToConnection(connectionIndex: number): VirtualCursorNavigationResult {
    const currentNode = this.getCurrentNode();
    if (!currentNode || connectionIndex >= currentNode.connectedTo.length) {
      return {
        success: false,
        nodeId: this.state.currentNodeId,
        previousNodeId: this.state.previousNodeId,
        direction: "next",
        mode: this.state.mode,
      };
    }

    const targetLabel = currentNode.connectedTo[connectionIndex];
    const targetNode = Array.from(this.a11yNodes.values()).find((n) => n.label === targetLabel);

    if (targetNode) {
      this.setPosition(targetNode.id);
      return {
        success: true,
        nodeId: targetNode.id,
        previousNodeId: this.state.previousNodeId,
        direction: "next",
        mode: this.state.mode,
      };
    }

    return {
      success: false,
      nodeId: this.state.currentNodeId,
      previousNodeId: this.state.previousNodeId,
      direction: "next",
      mode: this.state.mode,
    };
  }

  /**
   * Add node to navigation history
   */
  private addToHistory(nodeId: string): void {
    // Remove any forward history
    if (this.state.historyIndex < this.state.history.length - 1) {
      this.state.history = this.state.history.slice(0, this.state.historyIndex + 1);
    }

    // Don't add duplicate consecutive entries
    if (this.state.history[this.state.historyIndex] === nodeId) {
      return;
    }

    this.state.history.push(nodeId);
    this.state.historyIndex = this.state.history.length - 1;

    // Trim history if too long
    if (this.state.history.length > this.config.maxHistorySize) {
      this.state.history = this.state.history.slice(-this.config.maxHistorySize);
      this.state.historyIndex = this.state.history.length - 1;
    }
  }

  /**
   * Go back in navigation history
   */
  goBack(): VirtualCursorNavigationResult {
    if (this.state.historyIndex <= 0) {
      return {
        success: false,
        nodeId: this.state.currentNodeId,
        previousNodeId: this.state.previousNodeId,
        direction: "previous",
        mode: this.state.mode,
      };
    }

    this.state.historyIndex--;
    const nodeId = this.state.history[this.state.historyIndex];
    const previousNodeId = this.state.currentNodeId;

    this.state.previousNodeId = previousNodeId;
    this.state.currentNodeId = nodeId;

    this.config.onPositionChange?.(nodeId, previousNodeId);

    this.emit({
      type: "cursor:move",
      nodeId,
      previousNodeId,
    });

    return {
      success: true,
      nodeId,
      previousNodeId,
      direction: "previous",
      mode: this.state.mode,
    };
  }

  /**
   * Go forward in navigation history
   */
  goForward(): VirtualCursorNavigationResult {
    if (this.state.historyIndex >= this.state.history.length - 1) {
      return {
        success: false,
        nodeId: this.state.currentNodeId,
        previousNodeId: this.state.previousNodeId,
        direction: "next",
        mode: this.state.mode,
      };
    }

    this.state.historyIndex++;
    const nodeId = this.state.history[this.state.historyIndex];
    const previousNodeId = this.state.currentNodeId;

    this.state.previousNodeId = previousNodeId;
    this.state.currentNodeId = nodeId;

    this.config.onPositionChange?.(nodeId, previousNodeId);

    this.emit({
      type: "cursor:move",
      nodeId,
      previousNodeId,
    });

    return {
      success: true,
      nodeId,
      previousNodeId,
      direction: "next",
      mode: this.state.mode,
    };
  }

  /**
   * Check if can go back
   */
  canGoBack(): boolean {
    return this.state.historyIndex > 0;
  }

  /**
   * Check if can go forward
   */
  canGoForward(): boolean {
    return this.state.historyIndex < this.state.history.length - 1;
  }

  /**
   * Activate virtual cursor
   */
  activate(): void {
    if (this.state.isActive) return;

    this.state.isActive = true;

    // Focus first node if none focused
    if (!this.state.currentNodeId && this.nodes.length > 0) {
      this.setPosition(this.nodes[0].id);
    }

    this.emit({ type: "cursor:activate" });
  }

  /**
   * Deactivate virtual cursor
   */
  deactivate(): void {
    if (!this.state.isActive) return;

    this.state.isActive = false;
    this.emit({ type: "cursor:deactivate" });
  }

  /**
   * Check if cursor is active
   */
  isActive(): boolean {
    return this.state.isActive;
  }

  /**
   * Get current state
   */
  getState(): VirtualCursorState {
    return { ...this.state };
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.state.history = [];
    this.state.historyIndex = -1;
  }

  /**
   * Reset cursor to initial state
   */
  reset(): void {
    this.state = {
      currentNodeId: null,
      previousNodeId: null,
      history: [],
      historyIndex: -1,
      mode: this.config.defaultMode,
      isActive: false,
    };

    // Clear focus state in a11y nodes
    for (const node of this.a11yNodes.values()) {
      node.isFocused = false;
    }
  }

  /**
   * Add event listener
   */
  on(type: VirtualCursorEventType, listener: VirtualCursorEventListener): void {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  /**
   * Remove event listener
   */
  off(type: VirtualCursorEventType, listener: VirtualCursorEventListener): void {
    const listeners = this.listeners.get(type);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  /**
   * Emit event
   */
  private emit(event: VirtualCursorEvent): void {
    const listeners = this.listeners.get(event.type);
    if (listeners) {
      for (const listener of listeners) {
        listener(event);
      }
    }
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    this.reset();
    this.listeners.clear();
    this.nodes = [];
    this.a11yNodes.clear();
  }
}

/**
 * Create a virtual cursor with default configuration
 */
export function createVirtualCursor(config?: Partial<VirtualCursorConfig>): VirtualCursor {
  return new VirtualCursor(config);
}

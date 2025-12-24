/**
 * NavigationManager - Spatial navigation between graph nodes
 *
 * Provides intelligent navigation between nodes based on their position:
 * - Arrow key navigation finds nearest node in direction
 * - Wrapping behavior at graph edges
 * - Connected node navigation via edges
 * - Shortest path navigation
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import type { GraphNode as GraphNodeData, GraphEdge as GraphEdgeData } from "./types";

/**
 * Navigation direction
 */
export type NavigationDirection = "up" | "down" | "left" | "right";

/**
 * Navigation mode
 */
export type NavigationMode = "spatial" | "connected" | "order";

/**
 * Configuration for NavigationManager
 */
export interface NavigationManagerConfig {
  /** Navigation mode (default: spatial) */
  mode: NavigationMode;
  /** Maximum angle deviation for directional navigation in degrees (default: 45) */
  directionAngle: number;
  /** Enable wrapping at graph edges (default: true) */
  enableWrapping: boolean;
  /** Prefer connected nodes when available (default: false) */
  preferConnected: boolean;
  /** Maximum distance for spatial navigation (default: Infinity) */
  maxDistance: number;
}

/**
 * Navigation result
 */
export interface NavigationResult {
  /** Target node ID, or null if no valid target */
  targetNodeId: string | null;
  /** Distance to target node */
  distance: number;
  /** Whether wrapping was applied */
  wrapped: boolean;
  /** All candidate nodes considered */
  candidates: CandidateNode[];
}

/**
 * Candidate node for navigation
 */
export interface CandidateNode {
  /** Node ID */
  id: string;
  /** Distance from current node */
  distance: number;
  /** Angle from current node (in radians) */
  angle: number;
  /** Whether node is connected via edge */
  isConnected: boolean;
  /** Score for ranking (lower is better) */
  score: number;
}

/**
 * Navigation event types
 */
export type NavigationEventType =
  | "navigation:moved"
  | "navigation:blocked"
  | "navigation:wrapped";

/**
 * Navigation event data
 */
export interface NavigationEvent {
  type: NavigationEventType;
  fromNodeId: string | null;
  toNodeId: string | null;
  direction: NavigationDirection;
  wrapped: boolean;
  candidates: CandidateNode[];
}

/**
 * Event listener callback type
 */
export type NavigationEventListener = (event: NavigationEvent) => void;

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: NavigationManagerConfig = {
  mode: "spatial",
  directionAngle: 45,
  enableWrapping: true,
  preferConnected: false,
  maxDistance: Infinity,
};

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculate angle between two points (in radians, 0 = right, PI/2 = down)
 */
function calculateAngle(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.atan2(toY - fromY, toX - fromX);
}

/**
 * Calculate distance between two points
 */
function calculateDistance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Get expected angle for navigation direction (in radians)
 */
function getDirectionAngle(direction: NavigationDirection): number {
  switch (direction) {
    case "right":
      return 0;
    case "down":
      return Math.PI / 2;
    case "left":
      return Math.PI;
    case "up":
      return -Math.PI / 2;
    default:
      return 0;
  }
}

/**
 * Normalize angle to [-PI, PI] range
 */
function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

/**
 * Calculate angular difference
 */
function angleDifference(angle1: number, angle2: number): number {
  return Math.abs(normalizeAngle(angle1 - angle2));
}

/**
 * NavigationManager class for spatial navigation between nodes
 *
 * @example
 * ```typescript
 * const navigation = new NavigationManager();
 *
 * navigation.on("navigation:moved", (event) => {
 *   console.log("Navigated to:", event.toNodeId);
 * });
 *
 * navigation.setNodes(nodes);
 * navigation.setEdges(edges);
 *
 * const result = navigation.navigate("node1", "right");
 * if (result.targetNodeId) {
 *   setFocusedNode(result.targetNodeId);
 * }
 *
 * // Cleanup
 * navigation.destroy();
 * ```
 */
export class NavigationManager {
  private config: NavigationManagerConfig;
  private nodes: GraphNodeData[] = [];
  private nodeMap: Map<string, GraphNodeData> = new Map();
  private connectionMap: Map<string, Set<string>> = new Map();

  // Event listeners
  private listeners: Map<NavigationEventType, Set<NavigationEventListener>> = new Map();

  constructor(config?: Partial<NavigationManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set the nodes array for navigation
   *
   * @param nodes - Array of graph nodes
   */
  setNodes(nodes: GraphNodeData[]): void {
    this.nodes = nodes;
    this.nodeMap.clear();
    for (const node of nodes) {
      this.nodeMap.set(node.id, node);
    }
  }

  /**
   * Set the edges array for connected navigation
   *
   * @param edges - Array of graph edges
   */
  setEdges(edges: GraphEdgeData[]): void {
    this.connectionMap.clear();

    for (const edge of edges) {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

      // Add bidirectional connections
      if (!this.connectionMap.has(sourceId)) {
        this.connectionMap.set(sourceId, new Set());
      }
      this.connectionMap.get(sourceId)!.add(targetId);

      if (!this.connectionMap.has(targetId)) {
        this.connectionMap.set(targetId, new Set());
      }
      this.connectionMap.get(targetId)!.add(sourceId);
    }
  }

  /**
   * Check if two nodes are connected
   */
  isConnected(nodeId1: string, nodeId2: string): boolean {
    const connections = this.connectionMap.get(nodeId1);
    return connections ? connections.has(nodeId2) : false;
  }

  /**
   * Get connected nodes for a given node
   */
  getConnectedNodes(nodeId: string): string[] {
    const connections = this.connectionMap.get(nodeId);
    return connections ? Array.from(connections) : [];
  }

  /**
   * Navigate from a node in a direction
   *
   * @param fromNodeId - Source node ID
   * @param direction - Navigation direction
   * @returns Navigation result
   */
  navigate(fromNodeId: string, direction: NavigationDirection): NavigationResult {
    const fromNode = this.nodeMap.get(fromNodeId);
    if (!fromNode) {
      return {
        targetNodeId: null,
        distance: Infinity,
        wrapped: false,
        candidates: [],
      };
    }

    const fromX = fromNode.x ?? 0;
    const fromY = fromNode.y ?? 0;
    const expectedAngle = getDirectionAngle(direction);
    const maxAngleDev = toRadians(this.config.directionAngle);

    // Calculate candidates
    const candidates: CandidateNode[] = [];

    for (const node of this.nodes) {
      if (node.id === fromNodeId) continue;

      const nodeX = node.x ?? 0;
      const nodeY = node.y ?? 0;
      const distance = calculateDistance(fromX, fromY, nodeX, nodeY);

      if (distance > this.config.maxDistance) continue;

      const angle = calculateAngle(fromX, fromY, nodeX, nodeY);
      const angleDev = angleDifference(angle, expectedAngle);

      const isConnected = this.isConnected(fromNodeId, node.id);

      // Calculate score (lower is better)
      let score = distance;

      // Penalize if outside direction angle
      if (angleDev > maxAngleDev) {
        score = Infinity; // Not a valid candidate for primary navigation
      }

      // Bonus for connected nodes
      if (this.config.preferConnected && isConnected) {
        score *= 0.8;
      }

      candidates.push({
        id: node.id,
        distance,
        angle,
        isConnected,
        score,
      });
    }

    // Sort by score
    candidates.sort((a, b) => a.score - b.score);

    // Find best candidate
    const validCandidates = candidates.filter((c) => c.score !== Infinity);
    let targetNodeId: string | null = null;
    let wrapped = false;

    if (validCandidates.length > 0) {
      targetNodeId = validCandidates[0].id;
    } else if (this.config.enableWrapping) {
      // Try wrapping to opposite side
      const wrappedResult = this.findWrappedTarget(fromNode, direction);
      if (wrappedResult) {
        targetNodeId = wrappedResult;
        wrapped = true;
      }
    }

    const result: NavigationResult = {
      targetNodeId,
      distance: targetNodeId
        ? candidates.find((c) => c.id === targetNodeId)?.distance ?? Infinity
        : Infinity,
      wrapped,
      candidates,
    };

    // Emit event
    if (targetNodeId) {
      this.emit({
        type: wrapped ? "navigation:wrapped" : "navigation:moved",
        fromNodeId,
        toNodeId: targetNodeId,
        direction,
        wrapped,
        candidates,
      });
    } else {
      this.emit({
        type: "navigation:blocked",
        fromNodeId,
        toNodeId: null,
        direction,
        wrapped: false,
        candidates,
      });
    }

    return result;
  }

  /**
   * Find wrapped target when hitting edge of graph
   */
  private findWrappedTarget(
    fromNode: GraphNodeData,
    direction: NavigationDirection
  ): string | null {
    const fromX = fromNode.x ?? 0;
    const fromY = fromNode.y ?? 0;

    // Find nodes on opposite side
    let candidates: { node: GraphNodeData; distance: number }[] = [];

    for (const node of this.nodes) {
      if (node.id === fromNode.id) continue;

      const nodeX = node.x ?? 0;
      const nodeY = node.y ?? 0;

      switch (direction) {
        case "right":
          // Wrap to leftmost nodes
          if (nodeX < fromX) {
            const distanceY = Math.abs(nodeY - fromY);
            candidates.push({ node, distance: distanceY });
          }
          break;
        case "left":
          // Wrap to rightmost nodes
          if (nodeX > fromX) {
            const distanceY = Math.abs(nodeY - fromY);
            candidates.push({ node, distance: distanceY });
          }
          break;
        case "down":
          // Wrap to topmost nodes
          if (nodeY < fromY) {
            const distanceX = Math.abs(nodeX - fromX);
            candidates.push({ node, distance: distanceX });
          }
          break;
        case "up":
          // Wrap to bottommost nodes
          if (nodeY > fromY) {
            const distanceX = Math.abs(nodeX - fromX);
            candidates.push({ node, distance: distanceX });
          }
          break;
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Sort by perpendicular distance to find best match
    candidates.sort((a, b) => a.distance - b.distance);

    // Among closest perpendicular, pick the extreme one
    const closestDistance = candidates[0].distance;
    const closestCandidates = candidates.filter(
      (c) => Math.abs(c.distance - closestDistance) < 10
    );

    // Sort by position to get the extreme one
    switch (direction) {
      case "right":
        closestCandidates.sort((a, b) => (a.node.x ?? 0) - (b.node.x ?? 0));
        break;
      case "left":
        closestCandidates.sort((a, b) => (b.node.x ?? 0) - (a.node.x ?? 0));
        break;
      case "down":
        closestCandidates.sort((a, b) => (a.node.y ?? 0) - (b.node.y ?? 0));
        break;
      case "up":
        closestCandidates.sort((a, b) => (b.node.y ?? 0) - (a.node.y ?? 0));
        break;
    }

    return closestCandidates[0].node.id;
  }

  /**
   * Navigate to connected nodes
   *
   * @param fromNodeId - Source node ID
   * @param direction - Navigation direction
   * @returns Target node ID or null
   */
  navigateConnected(fromNodeId: string, direction: NavigationDirection): string | null {
    const connectedIds = this.getConnectedNodes(fromNodeId);
    if (connectedIds.length === 0) return null;

    const fromNode = this.nodeMap.get(fromNodeId);
    if (!fromNode) return null;

    const fromX = fromNode.x ?? 0;
    const fromY = fromNode.y ?? 0;
    const expectedAngle = getDirectionAngle(direction);
    const maxAngleDev = toRadians(this.config.directionAngle);

    let bestCandidate: { id: string; score: number } | null = null;

    for (const connectedId of connectedIds) {
      const node = this.nodeMap.get(connectedId);
      if (!node) continue;

      const nodeX = node.x ?? 0;
      const nodeY = node.y ?? 0;
      const angle = calculateAngle(fromX, fromY, nodeX, nodeY);
      const angleDev = angleDifference(angle, expectedAngle);

      if (angleDev <= maxAngleDev) {
        const distance = calculateDistance(fromX, fromY, nodeX, nodeY);
        const score = distance;

        if (!bestCandidate || score < bestCandidate.score) {
          bestCandidate = { id: connectedId, score };
        }
      }
    }

    return bestCandidate?.id ?? null;
  }

  /**
   * Navigate to first node when no node is focused
   */
  navigateToFirst(): string | null {
    if (this.nodes.length === 0) return null;

    // Sort nodes by position (top-left first)
    const sortedNodes = [...this.nodes].sort((a, b) => {
      const aY = a.y ?? 0;
      const bY = b.y ?? 0;
      if (Math.abs(aY - bY) > 20) {
        return aY - bY;
      }
      return (a.x ?? 0) - (b.x ?? 0);
    });

    return sortedNodes[0].id;
  }

  /**
   * Navigate to last node
   */
  navigateToLast(): string | null {
    if (this.nodes.length === 0) return null;

    // Sort nodes by position (bottom-right first)
    const sortedNodes = [...this.nodes].sort((a, b) => {
      const aY = a.y ?? 0;
      const bY = b.y ?? 0;
      if (Math.abs(aY - bY) > 20) {
        return bY - aY;
      }
      return (b.x ?? 0) - (a.x ?? 0);
    });

    return sortedNodes[0].id;
  }

  /**
   * Navigate to center node (closest to geometric center)
   */
  navigateToCenter(): string | null {
    if (this.nodes.length === 0) return null;

    // Calculate geometric center
    let sumX = 0;
    let sumY = 0;
    for (const node of this.nodes) {
      sumX += node.x ?? 0;
      sumY += node.y ?? 0;
    }
    const centerX = sumX / this.nodes.length;
    const centerY = sumY / this.nodes.length;

    // Find closest node to center
    let closestNode: GraphNodeData | null = null;
    let closestDistance = Infinity;

    for (const node of this.nodes) {
      const distance = calculateDistance(centerX, centerY, node.x ?? 0, node.y ?? 0);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestNode = node;
      }
    }

    return closestNode?.id ?? null;
  }

  /**
   * Find nearest node to a position
   */
  findNearestNode(x: number, y: number, excludeId?: string): string | null {
    let closestNode: GraphNodeData | null = null;
    let closestDistance = Infinity;

    for (const node of this.nodes) {
      if (excludeId && node.id === excludeId) continue;

      const distance = calculateDistance(x, y, node.x ?? 0, node.y ?? 0);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestNode = node;
      }
    }

    return closestNode?.id ?? null;
  }

  /**
   * Add event listener
   *
   * @param type - Event type to listen for
   * @param listener - Callback function
   */
  on(type: NavigationEventType, listener: NavigationEventListener): void {
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
  off(type: NavigationEventType, listener: NavigationEventListener): void {
    const typeListeners = this.listeners.get(type);
    if (typeListeners) {
      typeListeners.delete(listener);
    }
  }

  /**
   * Emit an event to all registered listeners
   */
  private emit(event: NavigationEvent): void {
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
  setConfig(config: Partial<NavigationManagerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): NavigationManagerConfig {
    return { ...this.config };
  }

  /**
   * Get node by ID
   */
  getNode(nodeId: string): GraphNodeData | undefined {
    return this.nodeMap.get(nodeId);
  }

  /**
   * Destroy the navigation manager and cleanup
   */
  destroy(): void {
    this.nodes = [];
    this.nodeMap.clear();
    this.connectionMap.clear();
    this.listeners.clear();
  }
}

/**
 * Default NavigationManager configuration
 */
export const DEFAULT_NAVIGATION_MANAGER_CONFIG = DEFAULT_CONFIG;

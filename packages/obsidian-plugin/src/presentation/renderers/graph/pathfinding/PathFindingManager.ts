/**
 * PathFindingManager - Manages path finding state and visualization
 *
 * Provides a high-level interface for:
 * - Node selection for path finding
 * - Path search execution
 * - Path visualization state
 * - Navigation between multiple paths
 *
 * @module presentation/renderers/graph/pathfinding
 * @since 1.0.0
 */

import type { GraphNode, GraphEdge } from "../types";
import type {
  PathFindingOptions,
  PathFindingState,
  PathFindingEvent,
  PathFindingEventListener,
  Path,
  PathVisualizationStyle,
} from "./PathFindingTypes";
import {
  INITIAL_PATH_FINDING_STATE,
  DEFAULT_PATH_FINDING_OPTIONS,
  DEFAULT_PATH_VISUALIZATION_STYLE,
} from "./PathFindingTypes";
import { PathFinder } from "./PathFinder";

/**
 * Configuration for PathFindingManager
 */
export interface PathFindingManagerConfig {
  /** Path finding options */
  pathFindingOptions: PathFindingOptions;
  /** Visualization style */
  visualizationStyle: PathVisualizationStyle;
}

/**
 * Default PathFindingManager configuration
 */
export const DEFAULT_PATH_FINDING_MANAGER_CONFIG: PathFindingManagerConfig = {
  pathFindingOptions: DEFAULT_PATH_FINDING_OPTIONS,
  visualizationStyle: DEFAULT_PATH_VISUALIZATION_STYLE,
};

/**
 * PathFindingManager - Manages path finding state and UI
 */
export class PathFindingManager {
  private config: PathFindingManagerConfig;
  private pathFinder: PathFinder;
  private state: PathFindingState;
  private listeners: Set<PathFindingEventListener> = new Set();
  private nodes: GraphNode[] = [];

  constructor(config: Partial<PathFindingManagerConfig> = {}) {
    this.config = {
      pathFindingOptions: {
        ...DEFAULT_PATH_FINDING_OPTIONS,
        ...config.pathFindingOptions,
      },
      visualizationStyle: {
        ...DEFAULT_PATH_VISUALIZATION_STYLE,
        ...config.visualizationStyle,
      },
    };

    this.pathFinder = new PathFinder(this.config.pathFindingOptions);
    this.state = {
      ...INITIAL_PATH_FINDING_STATE,
      options: this.config.pathFindingOptions,
    };
  }

  /**
   * Set the graph data
   *
   * @param nodes - Array of graph nodes
   * @param edges - Array of graph edges
   */
  setGraph(nodes: GraphNode[], edges: GraphEdge[]): void {
    this.nodes = nodes;
    this.pathFinder.setGraph(nodes, edges);
  }

  /**
   * Start path finding mode
   */
  start(): void {
    this.state = {
      ...INITIAL_PATH_FINDING_STATE,
      isActive: true,
      options: this.config.pathFindingOptions,
    };

    this.emit({ type: "pathfinding:start", state: this.getState() });
  }

  /**
   * Cancel path finding mode
   */
  cancel(): void {
    if (!this.state.isActive) {
      return;
    }

    this.state = { ...INITIAL_PATH_FINDING_STATE };
    this.emit({ type: "pathfinding:cancel", state: this.getState() });
  }

  /**
   * Clear current path and reset selection
   */
  clear(): void {
    const wasActive = this.state.isActive;
    this.state = {
      ...INITIAL_PATH_FINDING_STATE,
      isActive: wasActive,
      options: this.config.pathFindingOptions,
    };

    this.emit({ type: "pathfinding:clear", state: this.getState() });
  }

  /**
   * Handle node click for selection
   *
   * @param nodeId - The clicked node ID
   * @returns Whether the click was handled
   */
  handleNodeClick(nodeId: string): boolean {
    if (!this.state.isActive) {
      return false;
    }

    const node = this.nodes.find(n => n.id === nodeId);
    if (!node) {
      return false;
    }

    if (this.state.selectionStep === "source") {
      // Select source node
      this.state = {
        ...this.state,
        sourceNode: node,
        selectionStep: "target",
      };

      this.emit({
        type: "pathfinding:source-selected",
        state: this.getState(),
      });

      return true;
    }

    if (this.state.selectionStep === "target") {
      // Select target node
      this.state = {
        ...this.state,
        targetNode: node,
        selectionStep: "complete",
      };

      this.emit({
        type: "pathfinding:target-selected",
        state: this.getState(),
      });

      // Automatically start search
      this.search();

      return true;
    }

    return false;
  }

  /**
   * Set source node directly
   *
   * @param nodeId - Source node ID
   */
  setSource(nodeId: string): void {
    const node = this.nodes.find(n => n.id === nodeId);
    if (!node) {
      return;
    }

    this.state = {
      ...this.state,
      sourceNode: node,
      selectionStep: this.state.targetNode ? "complete" : "target",
      result: null,
    };

    this.emit({
      type: "pathfinding:source-selected",
      state: this.getState(),
    });

    // Auto-search if both nodes selected
    if (this.state.targetNode) {
      this.search();
    }
  }

  /**
   * Set target node directly
   *
   * @param nodeId - Target node ID
   */
  setTarget(nodeId: string): void {
    const node = this.nodes.find(n => n.id === nodeId);
    if (!node) {
      return;
    }

    this.state = {
      ...this.state,
      targetNode: node,
      selectionStep: this.state.sourceNode ? "complete" : "source",
      result: null,
    };

    this.emit({
      type: "pathfinding:target-selected",
      state: this.getState(),
    });

    // Auto-search if both nodes selected
    if (this.state.sourceNode) {
      this.search();
    }
  }

  /**
   * Swap source and target nodes
   */
  swapSourceTarget(): void {
    if (!this.state.sourceNode || !this.state.targetNode) {
      return;
    }

    const temp = this.state.sourceNode;
    this.state = {
      ...this.state,
      sourceNode: this.state.targetNode,
      targetNode: temp,
      result: null,
    };

    // Re-search with swapped nodes
    this.search();
  }

  /**
   * Execute path search
   */
  search(): void {
    if (!this.state.sourceNode || !this.state.targetNode) {
      return;
    }

    // Store IDs before state reassignment (TypeScript narrowing)
    const sourceId = this.state.sourceNode.id;
    const targetId = this.state.targetNode.id;

    this.state = {
      ...this.state,
      isSearching: true,
    };

    this.emit({
      type: "pathfinding:searching",
      state: this.getState(),
    });

    // Execute search
    const result = this.pathFinder.findPath(
      sourceId,
      targetId,
      this.state.options
    );

    this.state = {
      ...this.state,
      isSearching: false,
      result,
      currentPathIndex: 0,
    };

    if (result.found) {
      this.emit({
        type: "pathfinding:found",
        state: this.getState(),
        result,
        path: result.paths[0],
      });
    } else {
      this.emit({
        type: result.error ? "pathfinding:error" : "pathfinding:not-found",
        state: this.getState(),
        result,
        error: result.error,
      });
    }
  }

  /**
   * Navigate to next path (when multiple paths found)
   */
  nextPath(): Path | null {
    const { result } = this.state;
    if (!result || result.paths.length === 0) {
      return null;
    }

    const newIndex = (this.state.currentPathIndex + 1) % result.paths.length;
    const path = result.paths[newIndex];

    this.state = {
      ...this.state,
      currentPathIndex: newIndex,
    };

    this.emit({
      type: "pathfinding:path-change",
      state: this.getState(),
      path,
    });

    return path;
  }

  /**
   * Navigate to previous path
   */
  previousPath(): Path | null {
    const { result } = this.state;
    if (!result || result.paths.length === 0) {
      return null;
    }

    const newIndex =
      (this.state.currentPathIndex - 1 + result.paths.length) %
      result.paths.length;
    const path = result.paths[newIndex];

    this.state = {
      ...this.state,
      currentPathIndex: newIndex,
    };

    this.emit({
      type: "pathfinding:path-change",
      state: this.getState(),
      path,
    });

    return path;
  }

  /**
   * Select a specific path by index
   */
  selectPath(index: number): Path | null {
    const { result } = this.state;
    if (!result || index < 0 || index >= result.paths.length) {
      return null;
    }

    const path = result.paths[index];

    this.state = {
      ...this.state,
      currentPathIndex: index,
    };

    this.emit({
      type: "pathfinding:path-change",
      state: this.getState(),
      path,
    });

    return path;
  }

  /**
   * Get current path
   */
  getCurrentPath(): Path | null {
    if (!this.state.result || this.state.result.paths.length === 0) {
      return null;
    }
    return this.state.result.paths[this.state.currentPathIndex];
  }

  /**
   * Check if a node is on the current path
   */
  isNodeOnPath(nodeId: string): boolean {
    const path = this.getCurrentPath();
    if (!path) {
      return false;
    }
    return path.nodeIds.includes(nodeId);
  }

  /**
   * Check if an edge is on the current path
   */
  isEdgeOnPath(edgeId: string): boolean {
    const path = this.getCurrentPath();
    if (!path) {
      return false;
    }
    return path.edgeIds.includes(edgeId);
  }

  /**
   * Check if a node is the source node
   */
  isSourceNode(nodeId: string): boolean {
    return this.state.sourceNode?.id === nodeId;
  }

  /**
   * Check if a node is the target node
   */
  isTargetNode(nodeId: string): boolean {
    return this.state.targetNode?.id === nodeId;
  }

  /**
   * Get current state
   */
  getState(): PathFindingState {
    return { ...this.state };
  }

  /**
   * Get visualization style
   */
  getVisualizationStyle(): PathVisualizationStyle {
    return { ...this.config.visualizationStyle };
  }

  /**
   * Update path finding options
   */
  setOptions(options: Partial<PathFindingOptions>): void {
    this.config.pathFindingOptions = {
      ...this.config.pathFindingOptions,
      ...options,
    };
    this.state = {
      ...this.state,
      options: this.config.pathFindingOptions,
    };
    this.pathFinder.setOptions(options);
  }

  /**
   * Update visualization style
   */
  setVisualizationStyle(style: Partial<PathVisualizationStyle>): void {
    this.config.visualizationStyle = {
      ...this.config.visualizationStyle,
      ...style,
    };
  }

  /**
   * Get all highlighted node IDs (nodes on path)
   */
  getHighlightedNodeIds(): Set<string> {
    const path = this.getCurrentPath();
    if (!path) {
      return new Set();
    }
    return new Set(path.nodeIds);
  }

  /**
   * Get all highlighted edge IDs (edges on path)
   */
  getHighlightedEdgeIds(): Set<string> {
    const path = this.getCurrentPath();
    if (!path) {
      return new Set();
    }
    return new Set(path.edgeIds);
  }

  /**
   * Add event listener
   */
  addEventListener(listener: PathFindingEventListener): void {
    this.listeners.add(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: PathFindingEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Emit event to listeners
   */
  private emit(event: PathFindingEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error("Error in path finding event listener:", e);
      }
    }
  }

  /**
   * Destroy the manager and clean up resources
   */
  destroy(): void {
    this.listeners.clear();
    this.nodes = [];
  }
}

/**
 * Create a PathFindingManager instance
 */
export function createPathFindingManager(
  config?: Partial<PathFindingManagerConfig>
): PathFindingManager {
  return new PathFindingManager(config);
}

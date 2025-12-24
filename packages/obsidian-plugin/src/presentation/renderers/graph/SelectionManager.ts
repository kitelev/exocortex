/**
 * SelectionManager - Node and edge selection with multi-select and box selection
 *
 * Provides comprehensive selection support for graph visualization:
 * - Single-click selection (clears previous selection)
 * - Multi-select with modifier keys (Shift/Ctrl/Meta)
 * - Box/lasso selection for selecting multiple nodes
 * - Range selection (Shift+click for selecting from last selected)
 * - Visual selection rectangle rendering
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import type { GraphNode } from "./types";

/**
 * Rectangle for box selection
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Normalized rectangle with positive dimensions
 */
export interface NormalizedRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/**
 * Selection state containing selected items
 */
export interface SelectionState {
  /** Set of selected node IDs */
  selectedNodeIds: Set<string>;
  /** Set of selected edge IDs */
  selectedEdgeIds: Set<string>;
  /** ID of the last selected node (for range selection) */
  lastSelectedNodeId: string | null;
  /** Current selection box (if box selection is active) */
  selectionBox: Rect | null;
  /** Preview of nodes that would be selected by current box */
  boxPreviewNodeIds: Set<string>;
}

/**
 * Configuration for SelectionManager
 */
export interface SelectionManagerConfig {
  /** Modifier key for multi-select (default: 'shift') */
  multiSelectKey: "shift" | "ctrl" | "meta";
  /** Enable box selection (default: true) */
  boxSelectEnabled: boolean;
  /** Minimum box size in pixels to activate selection (default: 10) */
  boxSelectMinSize: number;
  /** Maximum movement in pixels to still count as a click (default: 5) */
  clickThreshold: number;
  /** Enable Ctrl/Cmd+A to select all (default: true) */
  enableSelectAll: boolean;
  /** Enable Escape to clear selection (default: true) */
  enableEscapeClear: boolean;
}

/**
 * Event types emitted by SelectionManager
 */
export type SelectionEventType =
  | "selection:change"
  | "selection:boxstart"
  | "selection:boxupdate"
  | "selection:boxend"
  | "selection:clear";

/**
 * Event data for selection events
 */
export interface SelectionEvent {
  type: SelectionEventType;
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  addedNodeIds?: Set<string>;
  removedNodeIds?: Set<string>;
  selectionBox?: Rect | null;
}

/**
 * Event listener callback type
 */
export type SelectionEventListener = (event: SelectionEvent) => void;

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: SelectionManagerConfig = {
  multiSelectKey: "shift",
  boxSelectEnabled: true,
  boxSelectMinSize: 10,
  clickThreshold: 5,
  enableSelectAll: true,
  enableEscapeClear: true,
};

/**
 * SelectionManager class for handling node and edge selection
 *
 * @example
 * ```typescript
 * const selection = new SelectionManager();
 *
 * selection.on("selection:change", (event) => {
 *   console.log("Selected nodes:", event.selectedNodeIds);
 * });
 *
 * // Single click selection
 * selection.handleNodeClick("node1", mockEvent);
 *
 * // Multi-select with Shift
 * selection.handleNodeClick("node2", { ...mockEvent, shiftKey: true });
 *
 * // Box selection
 * selection.startBoxSelect(0, 0);
 * selection.updateBoxSelect(100, 100, nodes);
 * selection.endBoxSelect(mockEvent);
 *
 * // Cleanup
 * selection.destroy();
 * ```
 */
export class SelectionManager {
  private state: SelectionState;
  private config: SelectionManagerConfig;
  private nodes: GraphNode[] = [];

  // Box selection start position
  private boxStartPosition: { x: number; y: number } | null = null;

  // Event listeners
  private listeners: Map<SelectionEventType, Set<SelectionEventListener>> = new Map();

  constructor(config?: Partial<SelectionManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = {
      selectedNodeIds: new Set(),
      selectedEdgeIds: new Set(),
      lastSelectedNodeId: null,
      selectionBox: null,
      boxPreviewNodeIds: new Set(),
    };
  }

  /**
   * Set the nodes array for hit testing during box selection
   *
   * @param nodes - Array of graph nodes
   */
  setNodes(nodes: GraphNode[]): void {
    this.nodes = nodes;
  }

  /**
   * Check if a modifier key is held for multi-select
   */
  private isMultiSelectKey(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
    switch (this.config.multiSelectKey) {
      case "shift":
        return event.shiftKey;
      case "ctrl":
        return event.ctrlKey;
      case "meta":
        return event.metaKey;
      default:
        return event.shiftKey;
    }
  }

  /**
   * Handle node click for selection
   *
   * @param nodeId - ID of the clicked node
   * @param event - Mouse/pointer event with modifier keys
   */
  handleNodeClick(
    nodeId: string,
    event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }
  ): void {
    const isMultiSelect = this.isMultiSelectKey(event);
    const previousSelection = new Set(this.state.selectedNodeIds);

    if (isMultiSelect) {
      // Toggle selection
      if (this.state.selectedNodeIds.has(nodeId)) {
        this.state.selectedNodeIds.delete(nodeId);
      } else {
        this.state.selectedNodeIds.add(nodeId);
      }
    } else {
      // Single selection - clear previous and select this node
      this.state.selectedNodeIds.clear();
      this.state.selectedNodeIds.add(nodeId);
    }

    this.state.lastSelectedNodeId = nodeId;

    // Calculate added/removed
    const addedNodeIds = new Set<string>();
    const removedNodeIds = new Set<string>();

    for (const id of this.state.selectedNodeIds) {
      if (!previousSelection.has(id)) {
        addedNodeIds.add(id);
      }
    }

    for (const id of previousSelection) {
      if (!this.state.selectedNodeIds.has(id)) {
        removedNodeIds.add(id);
      }
    }

    this.emit({
      type: "selection:change",
      selectedNodeIds: new Set(this.state.selectedNodeIds),
      selectedEdgeIds: new Set(this.state.selectedEdgeIds),
      addedNodeIds,
      removedNodeIds,
    });
  }

  /**
   * Handle edge click for selection
   *
   * @param edgeId - ID of the clicked edge
   * @param event - Mouse/pointer event with modifier keys
   */
  handleEdgeClick(
    edgeId: string,
    event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }
  ): void {
    const isMultiSelect = this.isMultiSelectKey(event);

    if (isMultiSelect) {
      // Toggle selection
      if (this.state.selectedEdgeIds.has(edgeId)) {
        this.state.selectedEdgeIds.delete(edgeId);
      } else {
        this.state.selectedEdgeIds.add(edgeId);
      }
    } else {
      // Single selection - clear previous and select this edge
      this.state.selectedEdgeIds.clear();
      this.state.selectedEdgeIds.add(edgeId);
      // Also clear node selection when clicking edge
      this.state.selectedNodeIds.clear();
    }

    this.emit({
      type: "selection:change",
      selectedNodeIds: new Set(this.state.selectedNodeIds),
      selectedEdgeIds: new Set(this.state.selectedEdgeIds),
    });
  }

  /**
   * Handle click on empty space (background)
   * Clears selection unless multi-select key is held
   *
   * @param event - Mouse/pointer event with modifier keys
   */
  handleBackgroundClick(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void {
    const isMultiSelect = this.isMultiSelectKey(event);

    if (!isMultiSelect) {
      this.clearSelection();
    }
  }

  /**
   * Start box selection
   *
   * @param worldX - World X coordinate of start position
   * @param worldY - World Y coordinate of start position
   */
  startBoxSelect(worldX: number, worldY: number): void {
    if (!this.config.boxSelectEnabled) return;

    this.boxStartPosition = { x: worldX, y: worldY };
    this.state.selectionBox = {
      x: worldX,
      y: worldY,
      width: 0,
      height: 0,
    };
    this.state.boxPreviewNodeIds.clear();

    this.emit({
      type: "selection:boxstart",
      selectedNodeIds: new Set(this.state.selectedNodeIds),
      selectedEdgeIds: new Set(this.state.selectedEdgeIds),
      selectionBox: { ...this.state.selectionBox },
    });
  }

  /**
   * Update box selection with current cursor position
   *
   * @param worldX - Current world X coordinate
   * @param worldY - Current world Y coordinate
   * @param nodes - Optional array of nodes for preview (uses setNodes() if not provided)
   */
  updateBoxSelect(worldX: number, worldY: number, nodes?: GraphNode[]): void {
    if (!this.state.selectionBox || !this.boxStartPosition) return;

    // Update box dimensions
    this.state.selectionBox = {
      x: this.boxStartPosition.x,
      y: this.boxStartPosition.y,
      width: worldX - this.boxStartPosition.x,
      height: worldY - this.boxStartPosition.y,
    };

    // Calculate preview of selected nodes
    const nodesToCheck = nodes || this.nodes;
    const normalizedBox = this.normalizeRect(this.state.selectionBox);

    this.state.boxPreviewNodeIds.clear();

    for (const node of nodesToCheck) {
      if (this.isNodeInRect(node, normalizedBox)) {
        this.state.boxPreviewNodeIds.add(node.id);
      }
    }

    this.emit({
      type: "selection:boxupdate",
      selectedNodeIds: new Set(this.state.selectedNodeIds),
      selectedEdgeIds: new Set(this.state.selectedEdgeIds),
      selectionBox: { ...this.state.selectionBox },
    });
  }

  /**
   * End box selection and apply selection
   *
   * @param event - Mouse/pointer event with modifier keys
   * @param nodes - Optional array of nodes (uses setNodes() if not provided)
   */
  endBoxSelect(
    event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
    nodes?: GraphNode[]
  ): void {
    if (!this.state.selectionBox || !this.boxStartPosition) {
      this.cancelBoxSelect();
      return;
    }

    const normalizedBox = this.normalizeRect(this.state.selectionBox);

    // Check if box is too small (treat as click)
    if (
      normalizedBox.width < this.config.boxSelectMinSize ||
      normalizedBox.height < this.config.boxSelectMinSize
    ) {
      this.cancelBoxSelect();
      return;
    }

    // Get nodes in box
    const nodesToCheck = nodes || this.nodes;
    const nodesInBox = nodesToCheck.filter((node) => this.isNodeInRect(node, normalizedBox));

    const previousSelection = new Set(this.state.selectedNodeIds);
    const isMultiSelect = this.isMultiSelectKey(event);

    if (isMultiSelect) {
      // Add to existing selection
      for (const node of nodesInBox) {
        this.state.selectedNodeIds.add(node.id);
      }
    } else {
      // Replace selection
      this.state.selectedNodeIds.clear();
      for (const node of nodesInBox) {
        this.state.selectedNodeIds.add(node.id);
      }
    }

    // Update last selected if we selected anything
    if (nodesInBox.length > 0) {
      this.state.lastSelectedNodeId = nodesInBox[nodesInBox.length - 1].id;
    }

    // Calculate added/removed
    const addedNodeIds = new Set<string>();
    const removedNodeIds = new Set<string>();

    for (const id of this.state.selectedNodeIds) {
      if (!previousSelection.has(id)) {
        addedNodeIds.add(id);
      }
    }

    for (const id of previousSelection) {
      if (!this.state.selectedNodeIds.has(id)) {
        removedNodeIds.add(id);
      }
    }

    // Clear box state
    this.state.selectionBox = null;
    this.state.boxPreviewNodeIds.clear();
    this.boxStartPosition = null;

    this.emit({
      type: "selection:boxend",
      selectedNodeIds: new Set(this.state.selectedNodeIds),
      selectedEdgeIds: new Set(this.state.selectedEdgeIds),
      addedNodeIds,
      removedNodeIds,
      selectionBox: null,
    });

    this.emit({
      type: "selection:change",
      selectedNodeIds: new Set(this.state.selectedNodeIds),
      selectedEdgeIds: new Set(this.state.selectedEdgeIds),
      addedNodeIds,
      removedNodeIds,
    });
  }

  /**
   * Cancel box selection without applying
   */
  cancelBoxSelect(): void {
    if (!this.state.selectionBox) return;

    this.state.selectionBox = null;
    this.state.boxPreviewNodeIds.clear();
    this.boxStartPosition = null;

    this.emit({
      type: "selection:boxend",
      selectedNodeIds: new Set(this.state.selectedNodeIds),
      selectedEdgeIds: new Set(this.state.selectedEdgeIds),
      selectionBox: null,
    });
  }

  /**
   * Normalize a rectangle to have positive width/height
   */
  normalizeRect(rect: Rect): NormalizedRect {
    const minX = rect.width >= 0 ? rect.x : rect.x + rect.width;
    const minY = rect.height >= 0 ? rect.y : rect.y + rect.height;
    const maxX = rect.width >= 0 ? rect.x + rect.width : rect.x;
    const maxY = rect.height >= 0 ? rect.y + rect.height : rect.y;

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  /**
   * Check if a node is inside a normalized rectangle
   */
  private isNodeInRect(node: GraphNode, rect: NormalizedRect): boolean {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const radius = node.size ?? 8;

    // Check if node center is inside the rect (with some tolerance for radius)
    return (
      x >= rect.minX - radius &&
      x <= rect.maxX + radius &&
      y >= rect.minY - radius &&
      y <= rect.maxY + radius
    );
  }

  /**
   * Select all nodes
   *
   * @param nodes - Optional array of nodes to select (uses setNodes() if not provided)
   */
  selectAll(nodes?: GraphNode[]): void {
    if (!this.config.enableSelectAll) return;

    const nodesToSelect = nodes || this.nodes;
    const previousSelection = new Set(this.state.selectedNodeIds);

    this.state.selectedNodeIds.clear();
    for (const node of nodesToSelect) {
      this.state.selectedNodeIds.add(node.id);
    }

    // Calculate added
    const addedNodeIds = new Set<string>();
    for (const id of this.state.selectedNodeIds) {
      if (!previousSelection.has(id)) {
        addedNodeIds.add(id);
      }
    }

    this.emit({
      type: "selection:change",
      selectedNodeIds: new Set(this.state.selectedNodeIds),
      selectedEdgeIds: new Set(this.state.selectedEdgeIds),
      addedNodeIds,
      removedNodeIds: new Set(),
    });
  }

  /**
   * Clear all selection
   */
  clearSelection(): void {
    if (this.state.selectedNodeIds.size === 0 && this.state.selectedEdgeIds.size === 0) {
      return;
    }

    const removedNodeIds = new Set(this.state.selectedNodeIds);

    this.state.selectedNodeIds.clear();
    this.state.selectedEdgeIds.clear();
    this.state.lastSelectedNodeId = null;

    this.emit({
      type: "selection:clear",
      selectedNodeIds: new Set(),
      selectedEdgeIds: new Set(),
      removedNodeIds,
    });

    this.emit({
      type: "selection:change",
      selectedNodeIds: new Set(),
      selectedEdgeIds: new Set(),
      removedNodeIds,
    });
  }

  /**
   * Handle keyboard shortcuts
   *
   * @param event - Keyboard event
   * @returns true if event was handled
   */
  handleKeyDown(event: KeyboardEvent): boolean {
    // Select all: Ctrl/Cmd+A
    if (
      this.config.enableSelectAll &&
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "a"
    ) {
      event.preventDefault();
      this.selectAll();
      return true;
    }

    // Clear selection: Escape
    if (this.config.enableEscapeClear && event.key === "Escape") {
      if (this.state.selectionBox) {
        this.cancelBoxSelect();
        return true;
      }
      if (this.state.selectedNodeIds.size > 0 || this.state.selectedEdgeIds.size > 0) {
        this.clearSelection();
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a node is selected
   */
  isNodeSelected(nodeId: string): boolean {
    return this.state.selectedNodeIds.has(nodeId);
  }

  /**
   * Check if an edge is selected
   */
  isEdgeSelected(edgeId: string): boolean {
    return this.state.selectedEdgeIds.has(edgeId);
  }

  /**
   * Check if a node is in box selection preview
   */
  isNodeInBoxPreview(nodeId: string): boolean {
    return this.state.boxPreviewNodeIds.has(nodeId);
  }

  /**
   * Get the current selection state
   */
  getSelectionState(): SelectionState {
    return {
      selectedNodeIds: new Set(this.state.selectedNodeIds),
      selectedEdgeIds: new Set(this.state.selectedEdgeIds),
      lastSelectedNodeId: this.state.lastSelectedNodeId,
      selectionBox: this.state.selectionBox ? { ...this.state.selectionBox } : null,
      boxPreviewNodeIds: new Set(this.state.boxPreviewNodeIds),
    };
  }

  /**
   * Get array of selected node IDs
   */
  getSelectedNodeIds(): string[] {
    return Array.from(this.state.selectedNodeIds);
  }

  /**
   * Get array of selected edge IDs
   */
  getSelectedEdgeIds(): string[] {
    return Array.from(this.state.selectedEdgeIds);
  }

  /**
   * Get count of selected nodes
   */
  getSelectedNodeCount(): number {
    return this.state.selectedNodeIds.size;
  }

  /**
   * Get count of selected edges
   */
  getSelectedEdgeCount(): number {
    return this.state.selectedEdgeIds.size;
  }

  /**
   * Check if box selection is active
   */
  isBoxSelecting(): boolean {
    return this.state.selectionBox !== null;
  }

  /**
   * Get the current selection box (if active)
   */
  getSelectionBox(): Rect | null {
    return this.state.selectionBox ? { ...this.state.selectionBox } : null;
  }

  /**
   * Programmatically set selected nodes
   *
   * @param nodeIds - Array of node IDs to select
   */
  setSelectedNodes(nodeIds: string[]): void {
    const previousSelection = new Set(this.state.selectedNodeIds);

    this.state.selectedNodeIds = new Set(nodeIds);

    const addedNodeIds = new Set<string>();
    const removedNodeIds = new Set<string>();

    for (const id of nodeIds) {
      if (!previousSelection.has(id)) {
        addedNodeIds.add(id);
      }
    }

    for (const id of previousSelection) {
      if (!this.state.selectedNodeIds.has(id)) {
        removedNodeIds.add(id);
      }
    }

    if (addedNodeIds.size > 0 || removedNodeIds.size > 0) {
      this.emit({
        type: "selection:change",
        selectedNodeIds: new Set(this.state.selectedNodeIds),
        selectedEdgeIds: new Set(this.state.selectedEdgeIds),
        addedNodeIds,
        removedNodeIds,
      });
    }
  }

  /**
   * Programmatically set selected edges
   *
   * @param edgeIds - Array of edge IDs to select
   */
  setSelectedEdges(edgeIds: string[]): void {
    this.state.selectedEdgeIds = new Set(edgeIds);

    this.emit({
      type: "selection:change",
      selectedNodeIds: new Set(this.state.selectedNodeIds),
      selectedEdgeIds: new Set(this.state.selectedEdgeIds),
    });
  }

  /**
   * Add event listener
   *
   * @param type - Event type to listen for
   * @param listener - Callback function
   */
  on(type: SelectionEventType, listener: SelectionEventListener): void {
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
  off(type: SelectionEventType, listener: SelectionEventListener): void {
    const typeListeners = this.listeners.get(type);
    if (typeListeners) {
      typeListeners.delete(listener);
    }
  }

  /**
   * Emit an event to all registered listeners
   */
  private emit(event: SelectionEvent): void {
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
  setConfig(config: Partial<SelectionManagerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): SelectionManagerConfig {
    return { ...this.config };
  }

  /**
   * Destroy the selection manager and clear state
   */
  destroy(): void {
    this.state.selectedNodeIds.clear();
    this.state.selectedEdgeIds.clear();
    this.state.boxPreviewNodeIds.clear();
    this.state.selectionBox = null;
    this.state.lastSelectedNodeId = null;
    this.boxStartPosition = null;
    this.listeners.clear();
    this.nodes = [];
  }
}

/**
 * Default SelectionManager configuration
 */
export const DEFAULT_SELECTION_MANAGER_CONFIG = DEFAULT_CONFIG;

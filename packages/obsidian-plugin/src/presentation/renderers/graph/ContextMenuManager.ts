/**
 * ContextMenuManager - Context-aware right-click menus for graph nodes and edges
 *
 * Provides comprehensive context menu support for graph visualization:
 * - Right-click menus on nodes, edges, and canvas
 * - Extensible menu item providers
 * - Keyboard shortcut display
 * - Submenu support
 * - Action execution with target context
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
 * Context menu state
 */
export interface ContextMenuState {
  /** Whether the menu is visible */
  visible: boolean;
  /** Screen position of the menu */
  position: Point;
  /** Current menu target */
  target: ContextMenuTarget | null;
  /** Menu items to display */
  items: ContextMenuItem[];
}

/**
 * Target types for context menu
 */
export type ContextMenuTarget =
  | { type: "node"; nodeId: string; node: GraphNode }
  | { type: "edge"; edgeId: string; edge: GraphEdge }
  | { type: "canvas"; position: Point }
  | { type: "selection"; nodeIds: string[]; edgeIds: string[] };

/**
 * Context menu item definition
 */
export interface ContextMenuItem {
  /** Unique identifier for the item */
  id: string;
  /** Display label */
  label: string;
  /** Optional icon (CSS class or icon name) */
  icon?: string;
  /** Optional keyboard shortcut display */
  shortcut?: string;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Whether this is a danger action (red styling) */
  danger?: boolean;
  /** Optional submenu items */
  submenu?: ContextMenuItem[];
  /** Action to execute when clicked */
  action?: (target: ContextMenuTarget) => void | Promise<void>;
  /** Separator after this item */
  separator?: boolean;
}

/**
 * Provider interface for context menu items
 */
export interface ContextMenuProvider {
  /** Unique identifier for this provider */
  id: string;
  /** Priority for ordering (higher = earlier) */
  priority: number;
  /**
   * Check if this provider applies to the given target
   */
  appliesTo(target: ContextMenuTarget): boolean;
  /**
   * Get menu items for the given target
   */
  getItems(target: ContextMenuTarget): ContextMenuItem[];
}

/**
 * Renderer interface for context menu display
 */
export interface ContextMenuRenderer {
  /**
   * Render the context menu
   */
  render(state: ContextMenuState): void;
  /**
   * Hide the context menu
   */
  hide(): void;
  /**
   * Check if menu is visible
   */
  isVisible(): boolean;
  /**
   * Update menu position
   */
  updatePosition(position: Point): void;
  /**
   * Destroy the renderer
   */
  destroy(): void;
}

/**
 * Configuration for ContextMenuManager
 */
export interface ContextMenuManagerConfig {
  /** Delay in ms before auto-hiding menu on mouse leave (default: 300) */
  hideDelay: number;
  /** Maximum width of the menu in pixels (default: 240) */
  maxWidth: number;
  /** Whether to prevent default browser context menu (default: true) */
  preventDefaultContextMenu: boolean;
  /** Whether to close menu on item click (default: true) */
  closeOnAction: boolean;
  /** Whether to close menu on outside click (default: true) */
  closeOnOutsideClick: boolean;
  /** Whether to close menu on Escape key (default: true) */
  closeOnEscape: boolean;
}

/**
 * Event types emitted by ContextMenuManager
 */
export type ContextMenuEventType =
  | "contextmenu:show"
  | "contextmenu:hide"
  | "contextmenu:action"
  | "contextmenu:submenu:open"
  | "contextmenu:submenu:close";

/**
 * Event data for context menu events
 */
export interface ContextMenuEvent {
  type: ContextMenuEventType;
  /** Menu target */
  target: ContextMenuTarget | null;
  /** Screen position */
  position: Point;
  /** Action item (for action events) */
  actionItem?: ContextMenuItem;
  /** Submenu item (for submenu events) */
  submenuItem?: ContextMenuItem;
}

/**
 * Event listener callback type
 */
export type ContextMenuEventListener = (event: ContextMenuEvent) => void;

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: ContextMenuManagerConfig = {
  hideDelay: 300,
  maxWidth: 240,
  preventDefaultContextMenu: true,
  closeOnAction: true,
  closeOnOutsideClick: true,
  closeOnEscape: true,
};

/**
 * ContextMenuManager class for handling context menu interactions
 *
 * @example
 * ```typescript
 * const contextMenu = new ContextMenuManager({
 *   renderer: myContextMenuRenderer,
 * });
 *
 * // Register providers
 * contextMenu.registerProvider(new NodeContextMenuProvider(app));
 * contextMenu.registerProvider(new EdgeContextMenuProvider(app));
 *
 * // Listen for events
 * contextMenu.on("contextmenu:action", (event) => {
 *   console.log("Action executed:", event.actionItem?.id);
 * });
 *
 * // Show context menu on right-click
 * contextMenu.show({ type: "node", nodeId: "1", node }, { x: 100, y: 100 });
 *
 * // Cleanup
 * contextMenu.destroy();
 * ```
 */
export class ContextMenuManager {
  private state: ContextMenuState;
  private config: ContextMenuManagerConfig;
  private providers: ContextMenuProvider[] = [];
  private renderer: ContextMenuRenderer | null = null;

  // Node and edge lookup for target resolution
  private nodeMap: Map<string, GraphNode> = new Map();
  private edgeMap: Map<string, GraphEdge> = new Map();

  // Selection state for multi-select context menu
  private selectedNodeIds: Set<string> = new Set();
  private selectedEdgeIds: Set<string> = new Set();

  // Timer for delayed hide
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  // Event listeners
  private listeners: Map<ContextMenuEventType, Set<ContextMenuEventListener>> = new Map();

  // Keyboard event handler bound reference
  private boundHandleKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private boundHandleClick: ((e: MouseEvent) => void) | null = null;

  constructor(options?: {
    config?: Partial<ContextMenuManagerConfig>;
    renderer?: ContextMenuRenderer;
  }) {
    this.config = { ...DEFAULT_CONFIG, ...options?.config };
    this.renderer = options?.renderer ?? null;

    this.state = {
      visible: false,
      position: { x: 0, y: 0 },
      target: null,
      items: [],
    };

    this.setupGlobalListeners();
  }

  /**
   * Set up global event listeners for closing the menu
   */
  private setupGlobalListeners(): void {
    if (this.config.closeOnEscape) {
      this.boundHandleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape" && this.state.visible) {
          this.hide();
        }
      };
      document.addEventListener("keydown", this.boundHandleKeyDown);
    }

    if (this.config.closeOnOutsideClick) {
      this.boundHandleClick = (_e: MouseEvent) => {
        if (this.state.visible && this.renderer) {
          // Check if click is outside the menu (renderer should handle this check)
          // For now, we'll hide on any click and let the menu handle its own clicks
          // This is a simplified approach - the renderer should intercept clicks on the menu
        }
      };
      // Delayed registration to avoid immediate closure
      setTimeout(() => {
        if (this.boundHandleClick) {
          document.addEventListener("click", this.boundHandleClick);
        }
      }, 0);
    }
  }

  /**
   * Remove global event listeners
   */
  private removeGlobalListeners(): void {
    if (this.boundHandleKeyDown) {
      document.removeEventListener("keydown", this.boundHandleKeyDown);
      this.boundHandleKeyDown = null;
    }
    if (this.boundHandleClick) {
      document.removeEventListener("click", this.boundHandleClick);
      this.boundHandleClick = null;
    }
  }

  /**
   * Set the nodes array and build lookup map
   */
  setNodes(nodes: GraphNode[]): void {
    this.nodeMap.clear();
    for (const node of nodes) {
      this.nodeMap.set(node.id, node);
    }
  }

  /**
   * Set the edges array and build lookup map
   */
  setEdges(edges: GraphEdge[]): void {
    this.edgeMap.clear();
    for (const edge of edges) {
      this.edgeMap.set(edge.id, edge);
    }
  }

  /**
   * Update selection state
   */
  setSelection(nodeIds: Set<string>, edgeIds: Set<string>): void {
    this.selectedNodeIds = new Set(nodeIds);
    this.selectedEdgeIds = new Set(edgeIds);
  }

  /**
   * Get a node by ID
   */
  getNode(id: string): GraphNode | undefined {
    return this.nodeMap.get(id);
  }

  /**
   * Get an edge by ID
   */
  getEdge(id: string): GraphEdge | undefined {
    return this.edgeMap.get(id);
  }

  /**
   * Set the context menu renderer
   */
  setRenderer(renderer: ContextMenuRenderer): void {
    this.renderer = renderer;
  }

  /**
   * Register a context menu provider
   */
  registerProvider(provider: ContextMenuProvider): void {
    this.providers.push(provider);
    // Sort by priority (higher first)
    this.providers.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Unregister a context menu provider
   */
  unregisterProvider(providerId: string): void {
    this.providers = this.providers.filter((p) => p.id !== providerId);
  }

  /**
   * Collect menu items from all applicable providers
   */
  private collectMenuItems(target: ContextMenuTarget): ContextMenuItem[] {
    const allItems: ContextMenuItem[] = [];

    for (const provider of this.providers) {
      if (provider.appliesTo(target)) {
        const items = provider.getItems(target);
        allItems.push(...items);
      }
    }

    return this.organizeMenuItems(allItems);
  }

  /**
   * Organize menu items with separators between groups
   * The separator property on an item means "show separator AFTER this item"
   */
  private organizeMenuItems(items: ContextMenuItem[]): ContextMenuItem[] {
    // Copy items and ensure trailing item doesn't have separator
    const organized = items.map((item, index) => {
      // Remove separator from the last item (no trailing separator)
      if (index === items.length - 1 && item.separator) {
        return { ...item, separator: false };
      }
      return item;
    });

    return organized;
  }

  /**
   * Show context menu for a target
   */
  show(target: ContextMenuTarget, screenPosition: Point): void {
    this.clearHideTimer();

    // Collect menu items
    const items = this.collectMenuItems(target);

    if (items.length === 0) {
      return;
    }

    // Update state
    this.state = {
      visible: true,
      position: screenPosition,
      target,
      items,
    };

    // Render
    if (this.renderer) {
      this.renderer.render(this.state);
    }

    // Emit show event
    this.emit({
      type: "contextmenu:show",
      target,
      position: screenPosition,
    });
  }

  /**
   * Show context menu for a node by ID
   */
  showForNode(nodeId: string, screenPosition: Point): void {
    const node = this.nodeMap.get(nodeId);
    if (!node) {
      console.warn(`ContextMenuManager: Node "${nodeId}" not found`);
      return;
    }

    // Check if this node is part of a multi-selection
    if (this.selectedNodeIds.size > 1 && this.selectedNodeIds.has(nodeId)) {
      // Show multi-selection context menu
      this.show(
        {
          type: "selection",
          nodeIds: Array.from(this.selectedNodeIds),
          edgeIds: Array.from(this.selectedEdgeIds),
        },
        screenPosition
      );
    } else {
      this.show({ type: "node", nodeId, node }, screenPosition);
    }
  }

  /**
   * Show context menu for an edge by ID
   */
  showForEdge(edgeId: string, screenPosition: Point): void {
    const edge = this.edgeMap.get(edgeId);
    if (!edge) {
      console.warn(`ContextMenuManager: Edge "${edgeId}" not found`);
      return;
    }

    this.show({ type: "edge", edgeId, edge }, screenPosition);
  }

  /**
   * Show context menu for canvas (background)
   */
  showForCanvas(worldPosition: Point, screenPosition: Point): void {
    this.show({ type: "canvas", position: worldPosition }, screenPosition);
  }

  /**
   * Hide the context menu
   */
  hide(): void {
    if (!this.state.visible) {
      return;
    }

    const previousTarget = this.state.target;
    const previousPosition = this.state.position;

    this.state = {
      visible: false,
      position: { x: 0, y: 0 },
      target: null,
      items: [],
    };

    if (this.renderer) {
      this.renderer.hide();
    }

    // Emit hide event
    this.emit({
      type: "contextmenu:hide",
      target: previousTarget,
      position: previousPosition,
    });
  }

  /**
   * Schedule delayed hide (e.g., on mouse leave)
   */
  scheduleHide(): void {
    this.clearHideTimer();
    this.hideTimer = setTimeout(() => {
      this.hide();
    }, this.config.hideDelay);
  }

  /**
   * Cancel scheduled hide
   */
  cancelScheduledHide(): void {
    this.clearHideTimer();
  }

  /**
   * Clear the hide timer
   */
  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  /**
   * Execute a menu item action
   */
  async executeAction(item: ContextMenuItem): Promise<void> {
    if (item.disabled || !item.action) {
      return;
    }

    const target = this.state.target;
    if (!target) {
      return;
    }

    // Emit action event before execution
    this.emit({
      type: "contextmenu:action",
      target,
      position: this.state.position,
      actionItem: item,
    });

    try {
      await item.action(target);
    } catch (error) {
      console.error(`ContextMenuManager: Action "${item.id}" failed:`, error);
    }

    // Close menu after action if configured
    if (this.config.closeOnAction) {
      this.hide();
    }
  }

  /**
   * Check if menu is currently visible
   */
  isVisible(): boolean {
    return this.state.visible;
  }

  /**
   * Get current menu state
   */
  getState(): ContextMenuState {
    return { ...this.state };
  }

  /**
   * Get current target
   */
  getTarget(): ContextMenuTarget | null {
    return this.state.target;
  }

  /**
   * Add event listener
   */
  on(type: ContextMenuEventType, listener: ContextMenuEventListener): void {
    let typeListeners = this.listeners.get(type);
    if (!typeListeners) {
      typeListeners = new Set();
      this.listeners.set(type, typeListeners);
    }
    typeListeners.add(listener);
  }

  /**
   * Remove event listener
   */
  off(type: ContextMenuEventType, listener: ContextMenuEventListener): void {
    const typeListeners = this.listeners.get(type);
    if (typeListeners) {
      typeListeners.delete(listener);
    }
  }

  /**
   * Emit an event to all registered listeners
   */
  private emit(event: ContextMenuEvent): void {
    const typeListeners = this.listeners.get(event.type);
    if (typeListeners) {
      for (const listener of typeListeners) {
        listener(event);
      }
    }
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<ContextMenuManagerConfig>): void {
    const previousConfig = this.config;
    this.config = { ...this.config, ...config };

    // Re-setup listeners if relevant config changed
    if (
      previousConfig.closeOnEscape !== this.config.closeOnEscape ||
      previousConfig.closeOnOutsideClick !== this.config.closeOnOutsideClick
    ) {
      this.removeGlobalListeners();
      this.setupGlobalListeners();
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): ContextMenuManagerConfig {
    return { ...this.config };
  }

  /**
   * Destroy the context menu manager and release resources
   */
  destroy(): void {
    this.clearHideTimer();
    this.removeGlobalListeners();

    if (this.renderer) {
      this.renderer.destroy();
    }

    this.state = {
      visible: false,
      position: { x: 0, y: 0 },
      target: null,
      items: [],
    };

    this.providers = [];
    this.nodeMap.clear();
    this.edgeMap.clear();
    this.selectedNodeIds.clear();
    this.selectedEdgeIds.clear();
    this.listeners.clear();
    this.renderer = null;
  }
}

/**
 * Default ContextMenuManager configuration
 */
export const DEFAULT_CONTEXT_MENU_MANAGER_CONFIG = DEFAULT_CONFIG;

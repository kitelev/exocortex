/**
 * KeyboardManager - Comprehensive keyboard navigation and shortcuts for graph visualization
 *
 * Provides keyboard navigation support for graph visualization:
 * - Tab/Shift+Tab for focus navigation between nodes
 * - Arrow keys for spatial navigation
 * - Enter to open focused node
 * - Delete/Backspace for node deletion
 * - Customizable key bindings
 * - Context-aware shortcuts
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import type { GraphNode as GraphNodeData } from "./types";

/**
 * Keyboard modifier state
 */
export interface ModifierState {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

/**
 * Key binding definition
 */
export interface KeyBinding {
  /** Key code (e.g., 'Tab', 'Enter', 'ArrowUp') */
  key: string;
  /** Required modifier keys */
  modifiers?: Partial<ModifierState>;
  /** Action identifier */
  action: string;
  /** Human-readable description */
  description: string;
  /** Context when this binding is active */
  when?: KeyBindingContext;
  /** Priority for conflict resolution (higher = priority) */
  priority?: number;
}

/**
 * Context conditions for key bindings
 */
export type KeyBindingContext =
  | "graphFocused"
  | "nodeSelected"
  | "multiSelection"
  | "searchOpen"
  | "modalOpen"
  | "edgeSelected"
  | "noSelection";

/**
 * Action handler function type
 */
export type ActionHandler = (event: KeyboardEvent) => void | boolean | Promise<void>;

/**
 * Configuration for KeyboardManager
 */
export interface KeyboardManagerConfig {
  /** Enable keyboard navigation (default: true) */
  enabled: boolean;
  /** Prevent default browser behavior for handled keys (default: true) */
  preventDefault: boolean;
  /** Stop event propagation for handled keys (default: true) */
  stopPropagation: boolean;
  /** Enable Tab navigation (default: true) */
  enableTabNavigation: boolean;
  /** Enable arrow key navigation (default: true) */
  enableArrowNavigation: boolean;
  /** Enable Enter to open nodes (default: true) */
  enableEnterOpen: boolean;
  /** Enable Delete/Backspace for deletion (default: true) */
  enableDelete: boolean;
  /** Enable Escape to clear focus (default: true) */
  enableEscapeClear: boolean;
  /** Enable search shortcut Ctrl/Cmd+F (default: true) */
  enableSearch: boolean;
  /** Enable help shortcut ? (default: true) */
  enableHelp: boolean;
}

/**
 * Keyboard event types
 */
export type KeyboardEventType =
  | "keyboard:action"
  | "keyboard:focus:change"
  | "keyboard:navigation"
  | "keyboard:help:toggle"
  | "keyboard:search:toggle"
  | "keyboard:binding:conflict";

/**
 * Keyboard event data
 */
export interface KeyboardEvent_Custom {
  type: KeyboardEventType;
  action?: string;
  focusedNodeId?: string | null;
  previousFocusedNodeId?: string | null;
  direction?: "up" | "down" | "left" | "right" | "next" | "prev";
  binding?: KeyBinding;
  conflictingBindings?: KeyBinding[];
}

/**
 * Event listener callback type
 */
export type KeyboardEventListener = (event: KeyboardEvent_Custom) => void;

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: KeyboardManagerConfig = {
  enabled: true,
  preventDefault: true,
  stopPropagation: true,
  enableTabNavigation: true,
  enableArrowNavigation: true,
  enableEnterOpen: true,
  enableDelete: true,
  enableEscapeClear: true,
  enableSearch: true,
  enableHelp: true,
};

/**
 * Default key bindings
 */
const DEFAULT_BINDINGS: KeyBinding[] = [
  // Navigation
  { key: "Tab", action: "focusNext", description: "Focus next node", when: "graphFocused" },
  { key: "Tab", modifiers: { shift: true }, action: "focusPrev", description: "Focus previous node", when: "graphFocused" },
  { key: "ArrowUp", action: "navigateUp", description: "Navigate up", when: "graphFocused" },
  { key: "ArrowDown", action: "navigateDown", description: "Navigate down", when: "graphFocused" },
  { key: "ArrowLeft", action: "navigateLeft", description: "Navigate left", when: "graphFocused" },
  { key: "ArrowRight", action: "navigateRight", description: "Navigate right", when: "graphFocused" },

  // Actions
  { key: "Enter", action: "openNode", description: "Open focused node", when: "nodeSelected" },
  { key: " ", action: "selectNode", description: "Toggle selection", when: "nodeSelected" },
  { key: "Delete", action: "deleteSelected", description: "Delete selected items", when: "nodeSelected" },
  { key: "Backspace", action: "deleteSelected", description: "Delete selected items", when: "nodeSelected" },

  // Selection
  { key: "a", modifiers: { ctrl: true }, action: "selectAll", description: "Select all nodes", when: "graphFocused" },
  { key: "a", modifiers: { meta: true }, action: "selectAll", description: "Select all nodes", when: "graphFocused" },
  { key: "Escape", action: "clearFocus", description: "Clear focus and selection", when: "graphFocused" },

  // Viewport
  { key: "Home", action: "fitToScreen", description: "Fit graph to screen", when: "graphFocused" },
  { key: "=", modifiers: { ctrl: true }, action: "zoomIn", description: "Zoom in", when: "graphFocused" },
  { key: "=", modifiers: { meta: true }, action: "zoomIn", description: "Zoom in", when: "graphFocused" },
  { key: "-", modifiers: { ctrl: true }, action: "zoomOut", description: "Zoom out", when: "graphFocused" },
  { key: "-", modifiers: { meta: true }, action: "zoomOut", description: "Zoom out", when: "graphFocused" },
  { key: "0", modifiers: { ctrl: true }, action: "resetZoom", description: "Reset zoom to 100%", when: "graphFocused" },
  { key: "0", modifiers: { meta: true }, action: "resetZoom", description: "Reset zoom to 100%", when: "graphFocused" },

  // Search and help
  { key: "f", modifiers: { ctrl: true }, action: "toggleSearch", description: "Toggle search", when: "graphFocused" },
  { key: "f", modifiers: { meta: true }, action: "toggleSearch", description: "Toggle search", when: "graphFocused" },
  { key: "?", action: "toggleHelp", description: "Show keyboard shortcuts", when: "graphFocused" },

  // Focus specific node by index (1-9)
  { key: "1", action: "focusNodeByIndex", description: "Focus node 1", when: "graphFocused" },
  { key: "2", action: "focusNodeByIndex", description: "Focus node 2", when: "graphFocused" },
  { key: "3", action: "focusNodeByIndex", description: "Focus node 3", when: "graphFocused" },
  { key: "4", action: "focusNodeByIndex", description: "Focus node 4", when: "graphFocused" },
  { key: "5", action: "focusNodeByIndex", description: "Focus node 5", when: "graphFocused" },
  { key: "6", action: "focusNodeByIndex", description: "Focus node 6", when: "graphFocused" },
  { key: "7", action: "focusNodeByIndex", description: "Focus node 7", when: "graphFocused" },
  { key: "8", action: "focusNodeByIndex", description: "Focus node 8", when: "graphFocused" },
  { key: "9", action: "focusNodeByIndex", description: "Focus node 9", when: "graphFocused" },
];

/**
 * Generate a unique key for binding lookup
 */
function getBindingKey(key: string, modifiers?: Partial<ModifierState>): string {
  const parts: string[] = [];
  if (modifiers?.ctrl) parts.push("ctrl");
  if (modifiers?.meta) parts.push("meta");
  if (modifiers?.alt) parts.push("alt");
  if (modifiers?.shift) parts.push("shift");
  parts.push(key.toLowerCase());
  return parts.join("+");
}

/**
 * KeyboardManager class for handling keyboard navigation and shortcuts
 *
 * @example
 * ```typescript
 * const keyboard = new KeyboardManager();
 *
 * keyboard.on("keyboard:action", (event) => {
 *   console.log("Action triggered:", event.action);
 * });
 *
 * keyboard.registerAction("openNode", (e) => {
 *   const nodeId = keyboard.getFocusedNodeId();
 *   if (nodeId) {
 *     openFile(nodeId);
 *   }
 * });
 *
 * keyboard.setNodes(nodes);
 * keyboard.setFocused(true);
 *
 * // Cleanup
 * keyboard.destroy();
 * ```
 */
export class KeyboardManager {
  private config: KeyboardManagerConfig;
  private bindings: Map<string, KeyBinding[]> = new Map();
  private actionHandlers: Map<string, ActionHandler> = new Map();
  private nodes: GraphNodeData[] = [];
  private focusedNodeId: string | null = null;
  private activeContexts: Set<KeyBindingContext> = new Set(["graphFocused"]);
  private isGraphFocused = false;

  // Event listeners
  private listeners: Map<KeyboardEventType, Set<KeyboardEventListener>> = new Map();

  // Bound event handler for cleanup
  private boundHandleKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private element: HTMLElement | null = null;

  constructor(config?: Partial<KeyboardManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registerDefaultBindings();
  }

  /**
   * Register default key bindings
   */
  private registerDefaultBindings(): void {
    for (const binding of DEFAULT_BINDINGS) {
      this.registerBinding(binding);
    }
  }

  /**
   * Register a key binding
   *
   * @param binding - Key binding configuration
   */
  registerBinding(binding: KeyBinding): void {
    const key = getBindingKey(binding.key, binding.modifiers);
    let existing = this.bindings.get(key);
    if (!existing) {
      existing = [];
      this.bindings.set(key, existing);
    }
    existing.push(binding);
    // Sort by priority (higher first)
    existing.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  /**
   * Unregister a key binding
   *
   * @param key - Key code
   * @param modifiers - Modifier state
   * @param action - Action to unregister (optional, removes all if not specified)
   */
  unregisterBinding(key: string, modifiers?: Partial<ModifierState>, action?: string): void {
    const bindingKey = getBindingKey(key, modifiers);
    if (action) {
      const existing = this.bindings.get(bindingKey);
      if (existing) {
        const filtered = existing.filter((b) => b.action !== action);
        if (filtered.length > 0) {
          this.bindings.set(bindingKey, filtered);
        } else {
          this.bindings.delete(bindingKey);
        }
      }
    } else {
      this.bindings.delete(bindingKey);
    }
  }

  /**
   * Register an action handler
   *
   * @param action - Action identifier
   * @param handler - Action handler function
   */
  registerAction(action: string, handler: ActionHandler): void {
    this.actionHandlers.set(action, handler);
  }

  /**
   * Unregister an action handler
   *
   * @param action - Action identifier
   */
  unregisterAction(action: string): void {
    this.actionHandlers.delete(action);
  }

  /**
   * Attach keyboard listener to an element
   *
   * @param element - HTML element to attach to
   */
  attach(element: HTMLElement): void {
    this.detach();
    this.element = element;

    // Make element focusable
    if (!element.hasAttribute("tabindex")) {
      element.setAttribute("tabindex", "0");
    }

    this.boundHandleKeyDown = this.handleKeyDown.bind(this);
    element.addEventListener("keydown", this.boundHandleKeyDown);
    element.addEventListener("focus", () => this.setGraphFocused(true));
    element.addEventListener("blur", () => this.setGraphFocused(false));
  }

  /**
   * Detach keyboard listener from element
   */
  detach(): void {
    if (this.element && this.boundHandleKeyDown) {
      this.element.removeEventListener("keydown", this.boundHandleKeyDown);
    }
    this.element = null;
    this.boundHandleKeyDown = null;
  }

  /**
   * Handle keydown event
   */
  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.config.enabled) return false;

    // Get modifier state from event
    const modifiers: ModifierState = {
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
      meta: event.metaKey,
    };

    // Generate binding key
    const bindingKey = getBindingKey(event.key, modifiers);

    // Find matching bindings
    const matchingBindings = this.bindings.get(bindingKey);
    if (!matchingBindings || matchingBindings.length === 0) {
      return false;
    }

    // Filter by context
    const applicableBindings = matchingBindings.filter((binding) => {
      if (!binding.when) return true;
      return this.isContextActive(binding.when);
    });

    if (applicableBindings.length === 0) {
      return false;
    }

    // Use highest priority binding
    const binding = applicableBindings[0];

    // Check for conflicts
    if (applicableBindings.length > 1) {
      this.emit({
        type: "keyboard:binding:conflict",
        binding,
        conflictingBindings: applicableBindings,
      });
    }

    // Execute action
    const handler = this.actionHandlers.get(binding.action);
    if (handler) {
      if (this.config.preventDefault) {
        event.preventDefault();
      }
      if (this.config.stopPropagation) {
        event.stopPropagation();
      }

      const result = handler(event);

      this.emit({
        type: "keyboard:action",
        action: binding.action,
        binding,
      });

      return result !== false;
    }

    return false;
  }

  /**
   * Check if a context condition is active
   */
  private isContextActive(context: KeyBindingContext): boolean {
    switch (context) {
      case "graphFocused":
        return this.isGraphFocused;
      case "nodeSelected":
        return this.focusedNodeId !== null;
      case "multiSelection":
        return this.activeContexts.has("multiSelection");
      case "searchOpen":
        return this.activeContexts.has("searchOpen");
      case "modalOpen":
        return this.activeContexts.has("modalOpen");
      case "edgeSelected":
        return this.activeContexts.has("edgeSelected");
      case "noSelection":
        return this.focusedNodeId === null;
      default:
        return this.activeContexts.has(context);
    }
  }

  /**
   * Set the nodes array for navigation
   *
   * @param nodes - Array of graph nodes
   */
  setNodes(nodes: GraphNodeData[]): void {
    this.nodes = nodes;
  }

  /**
   * Get the currently focused node ID
   */
  getFocusedNodeId(): string | null {
    return this.focusedNodeId;
  }

  /**
   * Set the focused node ID
   *
   * @param nodeId - Node ID to focus, or null to clear focus
   */
  setFocusedNode(nodeId: string | null): void {
    const previousFocusedNodeId = this.focusedNodeId;
    this.focusedNodeId = nodeId;

    // Update context
    if (nodeId) {
      this.activeContexts.add("nodeSelected");
    } else {
      this.activeContexts.delete("nodeSelected");
    }

    this.emit({
      type: "keyboard:focus:change",
      focusedNodeId: nodeId,
      previousFocusedNodeId,
    });
  }

  /**
   * Set whether the graph element is focused
   *
   * @param focused - Whether graph has focus
   */
  setGraphFocused(focused: boolean): void {
    this.isGraphFocused = focused;
    if (focused) {
      this.activeContexts.add("graphFocused");
    } else {
      this.activeContexts.delete("graphFocused");
    }
  }

  /**
   * Set a context as active or inactive
   *
   * @param context - Context name
   * @param active - Whether context is active
   */
  setContext(context: KeyBindingContext, active: boolean): void {
    if (active) {
      this.activeContexts.add(context);
    } else {
      this.activeContexts.delete(context);
    }
  }

  /**
   * Focus the next node in order
   */
  focusNext(): void {
    if (this.nodes.length === 0) return;

    let nextIndex = 0;
    if (this.focusedNodeId) {
      const currentIndex = this.nodes.findIndex((n) => n.id === this.focusedNodeId);
      if (currentIndex !== -1) {
        nextIndex = (currentIndex + 1) % this.nodes.length;
      }
    }

    this.setFocusedNode(this.nodes[nextIndex].id);
    this.emit({
      type: "keyboard:navigation",
      direction: "next",
      focusedNodeId: this.nodes[nextIndex].id,
    });
  }

  /**
   * Focus the previous node in order
   */
  focusPrev(): void {
    if (this.nodes.length === 0) return;

    let prevIndex = this.nodes.length - 1;
    if (this.focusedNodeId) {
      const currentIndex = this.nodes.findIndex((n) => n.id === this.focusedNodeId);
      if (currentIndex !== -1) {
        prevIndex = (currentIndex - 1 + this.nodes.length) % this.nodes.length;
      }
    }

    this.setFocusedNode(this.nodes[prevIndex].id);
    this.emit({
      type: "keyboard:navigation",
      direction: "prev",
      focusedNodeId: this.nodes[prevIndex].id,
    });
  }

  /**
   * Focus node by index (1-based)
   *
   * @param index - 1-based index
   */
  focusNodeByIndex(index: number): void {
    const arrayIndex = index - 1;
    if (arrayIndex >= 0 && arrayIndex < this.nodes.length) {
      this.setFocusedNode(this.nodes[arrayIndex].id);
    }
  }

  /**
   * Clear focus
   */
  clearFocus(): void {
    this.setFocusedNode(null);
  }

  /**
   * Get all registered bindings
   */
  getAllBindings(): KeyBinding[] {
    const result: KeyBinding[] = [];
    for (const bindings of this.bindings.values()) {
      result.push(...bindings);
    }
    return result;
  }

  /**
   * Get bindings for a specific action
   */
  getBindingsForAction(action: string): KeyBinding[] {
    const result: KeyBinding[] = [];
    for (const bindings of this.bindings.values()) {
      for (const binding of bindings) {
        if (binding.action === action) {
          result.push(binding);
        }
      }
    }
    return result;
  }

  /**
   * Get human-readable shortcut string for an action
   *
   * @param action - Action identifier
   * @returns Shortcut string like "Ctrl+A" or null if not found
   */
  getShortcutString(action: string): string | null {
    const bindings = this.getBindingsForAction(action);
    if (bindings.length === 0) return null;

    const binding = bindings[0];
    const parts: string[] = [];

    if (binding.modifiers?.ctrl) parts.push("Ctrl");
    if (binding.modifiers?.meta) parts.push("Cmd");
    if (binding.modifiers?.alt) parts.push("Alt");
    if (binding.modifiers?.shift) parts.push("Shift");

    // Format special keys
    let keyName = binding.key;
    if (keyName === " ") keyName = "Space";
    if (keyName.startsWith("Arrow")) keyName = keyName.replace("Arrow", "");
    parts.push(keyName);

    return parts.join("+");
  }

  /**
   * Add event listener
   *
   * @param type - Event type to listen for
   * @param listener - Callback function
   */
  on(type: KeyboardEventType, listener: KeyboardEventListener): void {
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
  off(type: KeyboardEventType, listener: KeyboardEventListener): void {
    const typeListeners = this.listeners.get(type);
    if (typeListeners) {
      typeListeners.delete(listener);
    }
  }

  /**
   * Emit an event to all registered listeners
   */
  private emit(event: KeyboardEvent_Custom): void {
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
  setConfig(config: Partial<KeyboardManagerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): KeyboardManagerConfig {
    return { ...this.config };
  }

  /**
   * Check if keyboard navigation is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable keyboard navigation
   */
  enable(): void {
    this.config.enabled = true;
  }

  /**
   * Disable keyboard navigation
   */
  disable(): void {
    this.config.enabled = false;
  }

  /**
   * Destroy the keyboard manager and cleanup
   */
  destroy(): void {
    this.detach();
    this.bindings.clear();
    this.actionHandlers.clear();
    this.listeners.clear();
    this.nodes = [];
    this.focusedNodeId = null;
    this.activeContexts.clear();
  }
}

/**
 * Default KeyboardManager configuration
 */
export const DEFAULT_KEYBOARD_MANAGER_CONFIG = DEFAULT_CONFIG;

/**
 * Default key bindings
 */
export const DEFAULT_KEY_BINDINGS = DEFAULT_BINDINGS;

/**
 * ShortcutRegistrar - Centralized shortcut management and customization
 *
 * Provides a single source of truth for keyboard shortcuts:
 * - Register and customize shortcuts
 * - Conflict detection and resolution
 * - Category-based organization
 * - Import/export shortcut profiles
 * - Help panel data generation
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import type { KeyBinding, ModifierState } from "./KeyboardManager";

/**
 * Shortcut category for organization
 */
export type ShortcutCategory =
  | "navigation"
  | "selection"
  | "viewport"
  | "actions"
  | "search"
  | "help"
  | "custom";

/**
 * Extended shortcut definition with category
 */
export interface Shortcut extends KeyBinding {
  /** Category for organization */
  category: ShortcutCategory;
  /** Whether shortcut can be customized */
  customizable: boolean;
  /** Default key binding (for reset) */
  defaultKey?: string;
  /** Default modifiers (for reset) */
  defaultModifiers?: Partial<ModifierState>;
  /** Whether shortcut is currently enabled */
  enabled: boolean;
}

/**
 * Shortcut conflict information
 */
export interface ShortcutConflict {
  /** Key combination that conflicts */
  key: string;
  /** Modifiers for the conflicting combination */
  modifiers?: Partial<ModifierState>;
  /** Shortcuts that conflict */
  shortcuts: Shortcut[];
}

/**
 * Shortcut profile for import/export
 */
export interface ShortcutProfile {
  /** Profile name */
  name: string;
  /** Profile version */
  version: string;
  /** Created timestamp */
  created: string;
  /** Shortcut overrides from defaults */
  shortcuts: Array<{
    action: string;
    key: string;
    modifiers?: Partial<ModifierState>;
    enabled: boolean;
  }>;
}

/**
 * Configuration for ShortcutRegistrar
 */
export interface ShortcutRegistrarConfig {
  /** Enable conflict detection (default: true) */
  detectConflicts: boolean;
  /** Allow duplicate bindings (default: false) */
  allowDuplicates: boolean;
  /** Enable custom shortcuts (default: true) */
  enableCustomization: boolean;
}

/**
 * Help panel section
 */
export interface HelpSection {
  /** Section title */
  title: string;
  /** Category */
  category: ShortcutCategory;
  /** Shortcuts in this section */
  shortcuts: Array<{
    action: string;
    description: string;
    shortcutKey: string;
    enabled: boolean;
  }>;
}

/**
 * Registrar event types
 */
export type RegistrarEventType =
  | "shortcut:registered"
  | "shortcut:updated"
  | "shortcut:removed"
  | "shortcut:conflict"
  | "profile:loaded"
  | "profile:saved";

/**
 * Registrar event data
 */
export interface RegistrarEvent {
  type: RegistrarEventType;
  shortcut?: Shortcut;
  conflict?: ShortcutConflict;
  profile?: ShortcutProfile;
}

/**
 * Event listener callback type
 */
export type RegistrarEventListener = (event: RegistrarEvent) => void;

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: ShortcutRegistrarConfig = {
  detectConflicts: true,
  allowDuplicates: false,
  enableCustomization: true,
};

/**
 * Default shortcuts organized by category
 */
const DEFAULT_SHORTCUTS: Shortcut[] = [
  // Navigation
  {
    key: "Tab",
    action: "focusNext",
    description: "Focus next node",
    when: "graphFocused",
    category: "navigation",
    customizable: true,
    enabled: true,
    defaultKey: "Tab",
  },
  {
    key: "Tab",
    modifiers: { shift: true },
    action: "focusPrev",
    description: "Focus previous node",
    when: "graphFocused",
    category: "navigation",
    customizable: true,
    enabled: true,
    defaultKey: "Tab",
    defaultModifiers: { shift: true },
  },
  {
    key: "ArrowUp",
    action: "navigateUp",
    description: "Navigate up",
    when: "graphFocused",
    category: "navigation",
    customizable: true,
    enabled: true,
    defaultKey: "ArrowUp",
  },
  {
    key: "ArrowDown",
    action: "navigateDown",
    description: "Navigate down",
    when: "graphFocused",
    category: "navigation",
    customizable: true,
    enabled: true,
    defaultKey: "ArrowDown",
  },
  {
    key: "ArrowLeft",
    action: "navigateLeft",
    description: "Navigate left",
    when: "graphFocused",
    category: "navigation",
    customizable: true,
    enabled: true,
    defaultKey: "ArrowLeft",
  },
  {
    key: "ArrowRight",
    action: "navigateRight",
    description: "Navigate right",
    when: "graphFocused",
    category: "navigation",
    customizable: true,
    enabled: true,
    defaultKey: "ArrowRight",
  },
  {
    key: "Home",
    action: "focusFirst",
    description: "Focus first node",
    when: "graphFocused",
    category: "navigation",
    customizable: true,
    enabled: true,
    defaultKey: "Home",
  },
  {
    key: "End",
    action: "focusLast",
    description: "Focus last node",
    when: "graphFocused",
    category: "navigation",
    customizable: true,
    enabled: true,
    defaultKey: "End",
  },

  // Selection
  {
    key: " ",
    action: "toggleSelect",
    description: "Toggle selection",
    when: "nodeSelected",
    category: "selection",
    customizable: true,
    enabled: true,
    defaultKey: " ",
  },
  {
    key: "a",
    modifiers: { ctrl: true },
    action: "selectAll",
    description: "Select all nodes",
    when: "graphFocused",
    category: "selection",
    customizable: true,
    enabled: true,
    defaultKey: "a",
    defaultModifiers: { ctrl: true },
  },
  {
    key: "a",
    modifiers: { meta: true },
    action: "selectAll",
    description: "Select all nodes (Mac)",
    when: "graphFocused",
    category: "selection",
    customizable: false,
    enabled: true,
    defaultKey: "a",
    defaultModifiers: { meta: true },
  },
  {
    key: "Escape",
    action: "clearSelection",
    description: "Clear selection",
    when: "graphFocused",
    category: "selection",
    customizable: true,
    enabled: true,
    defaultKey: "Escape",
  },
  {
    key: "i",
    action: "invertSelection",
    description: "Invert selection",
    when: "graphFocused",
    category: "selection",
    customizable: true,
    enabled: true,
    defaultKey: "i",
  },

  // Actions
  {
    key: "Enter",
    action: "openNode",
    description: "Open focused node",
    when: "nodeSelected",
    category: "actions",
    customizable: true,
    enabled: true,
    defaultKey: "Enter",
  },
  {
    key: "Delete",
    action: "deleteSelected",
    description: "Delete selected items",
    when: "nodeSelected",
    category: "actions",
    customizable: true,
    enabled: true,
    defaultKey: "Delete",
  },
  {
    key: "Backspace",
    action: "deleteSelected",
    description: "Delete selected items",
    when: "nodeSelected",
    category: "actions",
    customizable: false,
    enabled: true,
    defaultKey: "Backspace",
  },
  {
    key: "e",
    action: "editNode",
    description: "Edit focused node",
    when: "nodeSelected",
    category: "actions",
    customizable: true,
    enabled: true,
    defaultKey: "e",
  },
  {
    key: "c",
    modifiers: { ctrl: true },
    action: "copyNodes",
    description: "Copy selected nodes",
    when: "nodeSelected",
    category: "actions",
    customizable: true,
    enabled: true,
    defaultKey: "c",
    defaultModifiers: { ctrl: true },
  },

  // Viewport
  {
    key: "=",
    modifiers: { ctrl: true },
    action: "zoomIn",
    description: "Zoom in",
    when: "graphFocused",
    category: "viewport",
    customizable: true,
    enabled: true,
    defaultKey: "=",
    defaultModifiers: { ctrl: true },
  },
  {
    key: "-",
    modifiers: { ctrl: true },
    action: "zoomOut",
    description: "Zoom out",
    when: "graphFocused",
    category: "viewport",
    customizable: true,
    enabled: true,
    defaultKey: "-",
    defaultModifiers: { ctrl: true },
  },
  {
    key: "0",
    modifiers: { ctrl: true },
    action: "resetZoom",
    description: "Reset zoom to 100%",
    when: "graphFocused",
    category: "viewport",
    customizable: true,
    enabled: true,
    defaultKey: "0",
    defaultModifiers: { ctrl: true },
  },
  {
    key: "f",
    action: "fitToScreen",
    description: "Fit graph to screen",
    when: "graphFocused",
    category: "viewport",
    customizable: true,
    enabled: true,
    defaultKey: "f",
  },
  {
    key: "c",
    action: "centerOnFocused",
    description: "Center on focused node",
    when: "nodeSelected",
    category: "viewport",
    customizable: true,
    enabled: true,
    defaultKey: "c",
  },

  // Search
  {
    key: "f",
    modifiers: { ctrl: true },
    action: "toggleSearch",
    description: "Toggle search",
    when: "graphFocused",
    category: "search",
    customizable: true,
    enabled: true,
    defaultKey: "f",
    defaultModifiers: { ctrl: true },
  },
  {
    key: "/",
    action: "quickSearch",
    description: "Quick search",
    when: "graphFocused",
    category: "search",
    customizable: true,
    enabled: true,
    defaultKey: "/",
  },
  {
    key: "n",
    action: "findNext",
    description: "Find next match",
    when: "searchOpen",
    category: "search",
    customizable: true,
    enabled: true,
    defaultKey: "n",
  },
  {
    key: "n",
    modifiers: { shift: true },
    action: "findPrev",
    description: "Find previous match",
    when: "searchOpen",
    category: "search",
    customizable: true,
    enabled: true,
    defaultKey: "n",
    defaultModifiers: { shift: true },
  },

  // Help
  {
    key: "?",
    action: "toggleHelp",
    description: "Show keyboard shortcuts",
    when: "graphFocused",
    category: "help",
    customizable: true,
    enabled: true,
    defaultKey: "?",
  },
  {
    key: "F1",
    action: "toggleHelp",
    description: "Show keyboard shortcuts",
    when: "graphFocused",
    category: "help",
    customizable: false,
    enabled: true,
    defaultKey: "F1",
  },
];

/**
 * Category titles for help panel
 */
const CATEGORY_TITLES: Record<ShortcutCategory, string> = {
  navigation: "Navigation",
  selection: "Selection",
  viewport: "Viewport",
  actions: "Actions",
  search: "Search",
  help: "Help",
  custom: "Custom",
};

/**
 * Generate key combination string
 */
function getKeyComboString(key: string, modifiers?: Partial<ModifierState>): string {
  const parts: string[] = [];
  if (modifiers?.ctrl) parts.push("Ctrl");
  if (modifiers?.meta) parts.push("Cmd");
  if (modifiers?.alt) parts.push("Alt");
  if (modifiers?.shift) parts.push("Shift");

  // Format special keys
  let keyName = key;
  if (keyName === " ") keyName = "Space";
  if (keyName.startsWith("Arrow")) keyName = keyName.replace("Arrow", "");
  parts.push(keyName);

  return parts.join("+");
}

/**
 * Generate binding key for lookup
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
 * ShortcutRegistrar class for centralized shortcut management
 *
 * @example
 * ```typescript
 * const registrar = new ShortcutRegistrar();
 *
 * // Get all shortcuts
 * const shortcuts = registrar.getAllShortcuts();
 *
 * // Customize a shortcut
 * registrar.updateShortcut("openNode", {
 *   key: "o",
 *   modifiers: { ctrl: true }
 * });
 *
 * // Get help data
 * const helpSections = registrar.getHelpSections();
 *
 * // Export profile
 * const profile = registrar.exportProfile("My Profile");
 *
 * // Import profile
 * registrar.importProfile(profile);
 *
 * // Cleanup
 * registrar.destroy();
 * ```
 */
export class ShortcutRegistrar {
  private config: ShortcutRegistrarConfig;
  private shortcuts: Map<string, Shortcut> = new Map();
  private bindingIndex: Map<string, Set<string>> = new Map();

  // Event listeners
  private listeners: Map<RegistrarEventType, Set<RegistrarEventListener>> = new Map();

  constructor(config?: Partial<ShortcutRegistrarConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registerDefaults();
  }

  /**
   * Register default shortcuts
   */
  private registerDefaults(): void {
    for (const shortcut of DEFAULT_SHORTCUTS) {
      // Create a deep copy to avoid mutating the defaults
      this.registerShortcut({
        ...shortcut,
        modifiers: shortcut.modifiers ? { ...shortcut.modifiers } : undefined,
        defaultModifiers: shortcut.defaultModifiers ? { ...shortcut.defaultModifiers } : undefined,
      });
    }
  }

  /**
   * Register a shortcut
   *
   * @param shortcut - Shortcut to register
   */
  registerShortcut(shortcut: Shortcut): void {
    const existing = this.shortcuts.get(shortcut.action);
    if (existing) {
      this.removeFromIndex(existing);
    }

    this.shortcuts.set(shortcut.action, shortcut);
    this.addToIndex(shortcut);

    // Check for conflicts
    if (this.config.detectConflicts) {
      const conflict = this.detectConflict(shortcut);
      if (conflict) {
        this.emit({
          type: "shortcut:conflict",
          shortcut,
          conflict,
        });
      }
    }

    this.emit({
      type: existing ? "shortcut:updated" : "shortcut:registered",
      shortcut,
    });
  }

  /**
   * Add shortcut to binding index
   */
  private addToIndex(shortcut: Shortcut): void {
    const bindingKey = getBindingKey(shortcut.key, shortcut.modifiers);
    let actions = this.bindingIndex.get(bindingKey);
    if (!actions) {
      actions = new Set();
      this.bindingIndex.set(bindingKey, actions);
    }
    actions.add(shortcut.action);
  }

  /**
   * Remove shortcut from binding index
   */
  private removeFromIndex(shortcut: Shortcut): void {
    const bindingKey = getBindingKey(shortcut.key, shortcut.modifiers);
    const actions = this.bindingIndex.get(bindingKey);
    if (actions) {
      actions.delete(shortcut.action);
      if (actions.size === 0) {
        this.bindingIndex.delete(bindingKey);
      }
    }
  }

  /**
   * Detect conflicts for a shortcut
   */
  private detectConflict(shortcut: Shortcut): ShortcutConflict | null {
    const bindingKey = getBindingKey(shortcut.key, shortcut.modifiers);
    const actions = this.bindingIndex.get(bindingKey);

    if (!actions || actions.size <= 1) {
      return null;
    }

    // Filter to shortcuts with same context
    const conflictingShortcuts: Shortcut[] = [];
    for (const action of actions) {
      const s = this.shortcuts.get(action);
      if (s && s.enabled && (s.when === shortcut.when || !s.when || !shortcut.when)) {
        conflictingShortcuts.push(s);
      }
    }

    if (conflictingShortcuts.length <= 1) {
      return null;
    }

    return {
      key: shortcut.key,
      modifiers: shortcut.modifiers,
      shortcuts: conflictingShortcuts,
    };
  }

  /**
   * Update a shortcut's key binding
   *
   * @param action - Action to update
   * @param update - New key binding
   */
  updateShortcut(
    action: string,
    update: { key?: string; modifiers?: Partial<ModifierState>; enabled?: boolean }
  ): boolean {
    const shortcut = this.shortcuts.get(action);
    if (!shortcut) {
      return false;
    }

    if (!this.config.enableCustomization && !shortcut.customizable) {
      return false;
    }

    // Remove from old index
    this.removeFromIndex(shortcut);

    // Update shortcut
    if (update.key !== undefined) {
      shortcut.key = update.key;
    }
    if (update.modifiers !== undefined) {
      shortcut.modifiers = update.modifiers;
    }
    if (update.enabled !== undefined) {
      shortcut.enabled = update.enabled;
    }

    // Add to new index
    this.addToIndex(shortcut);

    // Check for conflicts
    if (this.config.detectConflicts) {
      const conflict = this.detectConflict(shortcut);
      if (conflict) {
        this.emit({
          type: "shortcut:conflict",
          shortcut,
          conflict,
        });
      }
    }

    this.emit({
      type: "shortcut:updated",
      shortcut,
    });

    return true;
  }

  /**
   * Reset a shortcut to default
   *
   * @param action - Action to reset
   */
  resetShortcut(action: string): boolean {
    const shortcut = this.shortcuts.get(action);
    if (!shortcut || !shortcut.defaultKey) {
      return false;
    }

    return this.updateShortcut(action, {
      key: shortcut.defaultKey,
      modifiers: shortcut.defaultModifiers,
      enabled: true,
    });
  }

  /**
   * Reset all shortcuts to defaults
   */
  resetAllShortcuts(): void {
    this.shortcuts.clear();
    this.bindingIndex.clear();
    this.registerDefaults();
  }

  /**
   * Get a shortcut by action
   */
  getShortcut(action: string): Shortcut | undefined {
    return this.shortcuts.get(action);
  }

  /**
   * Get all shortcuts
   */
  getAllShortcuts(): Shortcut[] {
    return Array.from(this.shortcuts.values());
  }

  /**
   * Get shortcuts by category
   */
  getShortcutsByCategory(category: ShortcutCategory): Shortcut[] {
    return this.getAllShortcuts().filter((s) => s.category === category);
  }

  /**
   * Get enabled shortcuts only
   */
  getEnabledShortcuts(): Shortcut[] {
    return this.getAllShortcuts().filter((s) => s.enabled);
  }

  /**
   * Check if a key combination is in use
   */
  isKeyInUse(key: string, modifiers?: Partial<ModifierState>): boolean {
    const bindingKey = getBindingKey(key, modifiers);
    const actions = this.bindingIndex.get(bindingKey);
    return actions !== undefined && actions.size > 0;
  }

  /**
   * Get actions for a key combination
   */
  getActionsForKey(key: string, modifiers?: Partial<ModifierState>): string[] {
    const bindingKey = getBindingKey(key, modifiers);
    const actions = this.bindingIndex.get(bindingKey);
    return actions ? Array.from(actions) : [];
  }

  /**
   * Get all conflicts
   */
  getAllConflicts(): ShortcutConflict[] {
    const conflicts: ShortcutConflict[] = [];
    const seen = new Set<string>();

    for (const shortcut of this.shortcuts.values()) {
      if (!shortcut.enabled) continue;

      const bindingKey = getBindingKey(shortcut.key, shortcut.modifiers);
      if (seen.has(bindingKey)) continue;
      seen.add(bindingKey);

      const conflict = this.detectConflict(shortcut);
      if (conflict) {
        conflicts.push(conflict);
      }
    }

    return conflicts;
  }

  /**
   * Get help sections for help panel
   */
  getHelpSections(): HelpSection[] {
    const sections: HelpSection[] = [];
    const categories: ShortcutCategory[] = [
      "navigation",
      "selection",
      "actions",
      "viewport",
      "search",
      "help",
      "custom",
    ];

    for (const category of categories) {
      const shortcuts = this.getShortcutsByCategory(category);
      if (shortcuts.length === 0) continue;

      // Deduplicate by action (some actions have multiple bindings)
      const seen = new Set<string>();
      const uniqueShortcuts = shortcuts.filter((s) => {
        if (seen.has(s.action)) return false;
        seen.add(s.action);
        return true;
      });

      sections.push({
        title: CATEGORY_TITLES[category],
        category,
        shortcuts: uniqueShortcuts.map((s) => ({
          action: s.action,
          description: s.description,
          shortcutKey: getKeyComboString(s.key, s.modifiers),
          enabled: s.enabled,
        })),
      });
    }

    return sections;
  }

  /**
   * Export current shortcuts as a profile
   *
   * @param name - Profile name
   */
  exportProfile(name: string): ShortcutProfile {
    const shortcuts: ShortcutProfile["shortcuts"] = [];

    for (const shortcut of this.shortcuts.values()) {
      if (!shortcut.customizable) continue;

      // Only include if different from default or disabled
      const isModified =
        shortcut.key !== shortcut.defaultKey ||
        JSON.stringify(shortcut.modifiers) !== JSON.stringify(shortcut.defaultModifiers) ||
        !shortcut.enabled;

      if (isModified) {
        shortcuts.push({
          action: shortcut.action,
          key: shortcut.key,
          modifiers: shortcut.modifiers,
          enabled: shortcut.enabled,
        });
      }
    }

    const profile: ShortcutProfile = {
      name,
      version: "1.0.0",
      created: new Date().toISOString(),
      shortcuts,
    };

    this.emit({
      type: "profile:saved",
      profile,
    });

    return profile;
  }

  /**
   * Import a shortcut profile
   *
   * @param profile - Profile to import
   */
  importProfile(profile: ShortcutProfile): void {
    // Reset to defaults first
    this.resetAllShortcuts();

    // Apply profile overrides
    for (const override of profile.shortcuts) {
      this.updateShortcut(override.action, {
        key: override.key,
        modifiers: override.modifiers,
        enabled: override.enabled,
      });
    }

    this.emit({
      type: "profile:loaded",
      profile,
    });
  }

  /**
   * Convert to KeyBinding array for KeyboardManager
   */
  toKeyBindings(): KeyBinding[] {
    return this.getEnabledShortcuts().map((s) => ({
      key: s.key,
      modifiers: s.modifiers,
      action: s.action,
      description: s.description,
      when: s.when,
      priority: s.priority,
    }));
  }

  /**
   * Add event listener
   *
   * @param type - Event type to listen for
   * @param listener - Callback function
   */
  on(type: RegistrarEventType, listener: RegistrarEventListener): void {
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
  off(type: RegistrarEventType, listener: RegistrarEventListener): void {
    const typeListeners = this.listeners.get(type);
    if (typeListeners) {
      typeListeners.delete(listener);
    }
  }

  /**
   * Emit an event to all registered listeners
   */
  private emit(event: RegistrarEvent): void {
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
  setConfig(config: Partial<ShortcutRegistrarConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): ShortcutRegistrarConfig {
    return { ...this.config };
  }

  /**
   * Destroy the registrar and cleanup
   */
  destroy(): void {
    this.shortcuts.clear();
    this.bindingIndex.clear();
    this.listeners.clear();
  }
}

/**
 * Default ShortcutRegistrar configuration
 */
export const DEFAULT_SHORTCUT_REGISTRAR_CONFIG = DEFAULT_CONFIG;

/**
 * Default shortcuts
 */
export const DEFAULT_GRAPH_SHORTCUTS = DEFAULT_SHORTCUTS;

/**
 * Category titles
 */
export const SHORTCUT_CATEGORY_TITLES = CATEGORY_TITLES;

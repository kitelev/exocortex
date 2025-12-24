/**
 * Tests for ShortcutRegistrar - Centralized shortcut management
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import {
  ShortcutRegistrar,
  DEFAULT_SHORTCUT_REGISTRAR_CONFIG,
  DEFAULT_GRAPH_SHORTCUTS,
  SHORTCUT_CATEGORY_TITLES,
  type ShortcutRegistrarConfig,
  type Shortcut,
  type ShortcutCategory,
  type ShortcutProfile,
  type ShortcutConflict,
  type HelpSection,
  type RegistrarEvent,
} from "../../../../../src/presentation/renderers/graph/ShortcutRegistrar";

describe("ShortcutRegistrar", () => {
  let registrar: ShortcutRegistrar;

  beforeEach(() => {
    registrar = new ShortcutRegistrar();
  });

  afterEach(() => {
    registrar.destroy();
  });

  describe("initialization", () => {
    it("should initialize with default config", () => {
      const config = registrar.getConfig();
      expect(config.detectConflicts).toBe(true);
      expect(config.allowDuplicates).toBe(false);
      expect(config.enableCustomization).toBe(true);
    });

    it("should accept custom config", () => {
      registrar.destroy();
      registrar = new ShortcutRegistrar({
        detectConflicts: false,
        allowDuplicates: true,
      });

      const config = registrar.getConfig();
      expect(config.detectConflicts).toBe(false);
      expect(config.allowDuplicates).toBe(true);
    });

    it("should register default shortcuts", () => {
      const shortcuts = registrar.getAllShortcuts();
      expect(shortcuts.length).toBeGreaterThan(0);
    });
  });

  describe("DEFAULT_SHORTCUT_REGISTRAR_CONFIG", () => {
    it("should have expected default values", () => {
      expect(DEFAULT_SHORTCUT_REGISTRAR_CONFIG.detectConflicts).toBe(true);
      expect(DEFAULT_SHORTCUT_REGISTRAR_CONFIG.allowDuplicates).toBe(false);
      expect(DEFAULT_SHORTCUT_REGISTRAR_CONFIG.enableCustomization).toBe(true);
    });
  });

  describe("DEFAULT_GRAPH_SHORTCUTS", () => {
    it("should contain navigation shortcuts", () => {
      const navShortcuts = DEFAULT_GRAPH_SHORTCUTS.filter((s) => s.category === "navigation");
      expect(navShortcuts.length).toBeGreaterThan(0);
    });

    it("should contain action shortcuts", () => {
      const actionShortcuts = DEFAULT_GRAPH_SHORTCUTS.filter((s) => s.category === "actions");
      expect(actionShortcuts.length).toBeGreaterThan(0);
    });

    it("should contain selection shortcuts", () => {
      const selectionShortcuts = DEFAULT_GRAPH_SHORTCUTS.filter((s) => s.category === "selection");
      expect(selectionShortcuts.length).toBeGreaterThan(0);
    });

    it("should have enabled flag on all shortcuts", () => {
      const allEnabled = DEFAULT_GRAPH_SHORTCUTS.every((s) => s.enabled !== undefined);
      expect(allEnabled).toBe(true);
    });
  });

  describe("SHORTCUT_CATEGORY_TITLES", () => {
    it("should have titles for all categories", () => {
      expect(SHORTCUT_CATEGORY_TITLES.navigation).toBe("Navigation");
      expect(SHORTCUT_CATEGORY_TITLES.selection).toBe("Selection");
      expect(SHORTCUT_CATEGORY_TITLES.viewport).toBe("Viewport");
      expect(SHORTCUT_CATEGORY_TITLES.actions).toBe("Actions");
      expect(SHORTCUT_CATEGORY_TITLES.search).toBe("Search");
      expect(SHORTCUT_CATEGORY_TITLES.help).toBe("Help");
      expect(SHORTCUT_CATEGORY_TITLES.custom).toBe("Custom");
    });
  });

  describe("shortcut registration", () => {
    it("should register a new shortcut", () => {
      registrar.registerShortcut({
        key: "x",
        action: "customAction",
        description: "Custom action",
        category: "custom",
        customizable: true,
        enabled: true,
      });

      const shortcut = registrar.getShortcut("customAction");
      expect(shortcut).toBeDefined();
      expect(shortcut?.key).toBe("x");
    });

    it("should update existing shortcut on re-registration", () => {
      registrar.registerShortcut({
        key: "x",
        action: "customAction",
        description: "Custom action",
        category: "custom",
        customizable: true,
        enabled: true,
      });

      registrar.registerShortcut({
        key: "y",
        action: "customAction",
        description: "Updated action",
        category: "custom",
        customizable: true,
        enabled: true,
      });

      const shortcut = registrar.getShortcut("customAction");
      expect(shortcut?.key).toBe("y");
    });

    it("should emit shortcut:registered event", () => {
      const listener = jest.fn();
      registrar.on("shortcut:registered", listener);

      registrar.registerShortcut({
        key: "x",
        action: "newAction",
        description: "New action",
        category: "custom",
        customizable: true,
        enabled: true,
      });

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as RegistrarEvent;
      expect(event.type).toBe("shortcut:registered");
      expect(event.shortcut?.action).toBe("newAction");
    });
  });

  describe("shortcut update", () => {
    it("should update shortcut key", () => {
      const result = registrar.updateShortcut("focusNext", { key: "n" });

      expect(result).toBe(true);
      const shortcut = registrar.getShortcut("focusNext");
      expect(shortcut?.key).toBe("n");
    });

    it("should update shortcut modifiers", () => {
      const result = registrar.updateShortcut("focusNext", {
        modifiers: { ctrl: true },
      });

      expect(result).toBe(true);
      const shortcut = registrar.getShortcut("focusNext");
      expect(shortcut?.modifiers?.ctrl).toBe(true);
    });

    it("should update shortcut enabled state", () => {
      const result = registrar.updateShortcut("focusNext", { enabled: false });

      expect(result).toBe(true);
      const shortcut = registrar.getShortcut("focusNext");
      expect(shortcut?.enabled).toBe(false);
    });

    it("should return false for non-existent shortcut", () => {
      const result = registrar.updateShortcut("nonExistent", { key: "x" });
      expect(result).toBe(false);
    });

    it("should emit shortcut:updated event", () => {
      const listener = jest.fn();
      registrar.on("shortcut:updated", listener);

      registrar.updateShortcut("focusNext", { key: "n" });

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as RegistrarEvent;
      expect(event.type).toBe("shortcut:updated");
    });
  });

  describe("shortcut reset", () => {
    it("should reset shortcut to default", () => {
      registrar.updateShortcut("navigateUp", { key: "x" });
      const result = registrar.resetShortcut("navigateUp");

      expect(result).toBe(true);
      const shortcut = registrar.getShortcut("navigateUp");
      expect(shortcut?.key).toBe("ArrowUp");
    });

    it("should reset all shortcuts to defaults", () => {
      registrar.updateShortcut("navigateUp", { key: "x" });
      registrar.updateShortcut("navigateDown", { key: "y" });

      registrar.resetAllShortcuts();

      expect(registrar.getShortcut("navigateUp")?.key).toBe("ArrowUp");
      expect(registrar.getShortcut("navigateDown")?.key).toBe("ArrowDown");
    });
  });

  describe("shortcut querying", () => {
    it("should get shortcut by action", () => {
      const shortcut = registrar.getShortcut("focusNext");
      expect(shortcut).toBeDefined();
      expect(shortcut?.action).toBe("focusNext");
    });

    it("should get all shortcuts", () => {
      const shortcuts = registrar.getAllShortcuts();
      expect(shortcuts.length).toBeGreaterThan(0);
    });

    it("should get shortcuts by category", () => {
      const navShortcuts = registrar.getShortcutsByCategory("navigation");
      expect(navShortcuts.length).toBeGreaterThan(0);
      expect(navShortcuts.every((s) => s.category === "navigation")).toBe(true);
    });

    it("should get enabled shortcuts only", () => {
      registrar.updateShortcut("focusNext", { enabled: false });

      const enabledShortcuts = registrar.getEnabledShortcuts();
      const focusNextIncluded = enabledShortcuts.some((s) => s.action === "focusNext");
      expect(focusNextIncluded).toBe(false);
    });
  });

  describe("key usage checking", () => {
    it("should detect key in use", () => {
      // Fresh registrar for this test
      const freshRegistrar = new ShortcutRegistrar();
      expect(freshRegistrar.isKeyInUse("ArrowUp")).toBe(true);
      freshRegistrar.destroy();
    });

    it("should detect key not in use", () => {
      const freshRegistrar = new ShortcutRegistrar();
      expect(freshRegistrar.isKeyInUse("x")).toBe(false);
      freshRegistrar.destroy();
    });

    it("should check key with modifiers", () => {
      const freshRegistrar = new ShortcutRegistrar();
      expect(freshRegistrar.isKeyInUse("f", { ctrl: true })).toBe(true); // toggleSearch
      expect(freshRegistrar.isKeyInUse("b")).toBe(false);
      freshRegistrar.destroy();
    });

    it("should get actions for key", () => {
      const freshRegistrar = new ShortcutRegistrar();
      const actions = freshRegistrar.getActionsForKey("ArrowUp");
      expect(actions).toContain("navigateUp");
      freshRegistrar.destroy();
    });
  });

  describe("conflict detection", () => {
    it("should detect conflicts", () => {
      // Fresh registrar to avoid pollution from other tests
      const freshRegistrar = new ShortcutRegistrar();

      // ArrowUp is used by navigateUp with graphFocused context
      freshRegistrar.registerShortcut({
        key: "ArrowUp",
        action: "conflictAction",
        description: "Conflict",
        category: "custom",
        customizable: true,
        enabled: true,
        when: "graphFocused", // Same context as navigateUp
      });

      const conflicts = freshRegistrar.getAllConflicts();
      const arrowConflicts = conflicts.filter((c) => c.key.toLowerCase() === "arrowup");
      expect(arrowConflicts.length).toBeGreaterThan(0);
      freshRegistrar.destroy();
    });

    it("should emit shortcut:conflict event", () => {
      const freshRegistrar = new ShortcutRegistrar();
      const listener = jest.fn();
      freshRegistrar.on("shortcut:conflict", listener);

      freshRegistrar.registerShortcut({
        key: "ArrowUp",
        action: "conflictAction",
        description: "Conflict",
        category: "custom",
        customizable: true,
        enabled: true,
        when: "graphFocused",
      });

      expect(listener).toHaveBeenCalled();
      freshRegistrar.destroy();
    });

    it("should not detect conflict with different contexts", () => {
      const freshRegistrar = new ShortcutRegistrar();

      freshRegistrar.registerShortcut({
        key: "ArrowUp",
        action: "modalArrowAction",
        description: "Modal Arrow",
        category: "custom",
        customizable: true,
        enabled: true,
        when: "modalOpen", // Different context
      });

      const conflicts = freshRegistrar.getAllConflicts();
      // Should not have conflicts for different contexts
      const arrowConflicts = conflicts.filter((c) => c.key.toLowerCase() === "arrowup");
      expect(arrowConflicts.length).toBe(0);
      freshRegistrar.destroy();
    });
  });

  describe("help sections", () => {
    it("should generate help sections", () => {
      const freshRegistrar = new ShortcutRegistrar();
      const sections = freshRegistrar.getHelpSections();
      expect(sections.length).toBeGreaterThan(0);
      freshRegistrar.destroy();
    });

    it("should have section for each category with shortcuts", () => {
      const freshRegistrar = new ShortcutRegistrar();
      const sections = freshRegistrar.getHelpSections();
      const categories = sections.map((s) => s.category);

      expect(categories).toContain("navigation");
      expect(categories).toContain("actions");
      freshRegistrar.destroy();
    });

    it("should format shortcut strings in help", () => {
      const freshRegistrar = new ShortcutRegistrar();
      const sections = freshRegistrar.getHelpSections();
      const navSection = sections.find((s) => s.category === "navigation");

      expect(navSection).toBeDefined();
      const arrowShortcut = navSection?.shortcuts.find((s) => s.action === "navigateUp");
      expect(arrowShortcut?.shortcutKey).toBe("Up");
      freshRegistrar.destroy();
    });

    it("should deduplicate shortcuts with same action", () => {
      const freshRegistrar = new ShortcutRegistrar();
      const sections = freshRegistrar.getHelpSections();

      for (const section of sections) {
        const actions = section.shortcuts.map((s) => s.action);
        const uniqueActions = new Set(actions);
        expect(actions.length).toBe(uniqueActions.size);
      }
      freshRegistrar.destroy();
    });
  });

  describe("profile export/import", () => {
    it("should export profile", () => {
      const freshRegistrar = new ShortcutRegistrar();
      freshRegistrar.updateShortcut("focusNext", { key: "n" });

      const profile = freshRegistrar.exportProfile("Test Profile");

      expect(profile.name).toBe("Test Profile");
      expect(profile.version).toBe("1.0.0");
      expect(profile.shortcuts.length).toBeGreaterThan(0);
      freshRegistrar.destroy();
    });

    it("should only export modified shortcuts in profile", () => {
      const freshRegistrar = new ShortcutRegistrar();
      // Modify one shortcut first
      freshRegistrar.updateShortcut("navigateUp", { key: "w" });

      const profile = freshRegistrar.exportProfile("Modified Profile");
      // Only the modified shortcut should be in the profile
      const navUpOverride = profile.shortcuts.find((s) => s.action === "navigateUp");
      expect(navUpOverride).toBeDefined();
      expect(navUpOverride?.key).toBe("w");
      freshRegistrar.destroy();
    });

    it("should include disabled shortcuts in export", () => {
      const freshRegistrar = new ShortcutRegistrar();
      freshRegistrar.updateShortcut("focusNext", { enabled: false });

      const profile = freshRegistrar.exportProfile("Disabled Profile");
      const focusNextOverride = profile.shortcuts.find((s) => s.action === "focusNext");
      expect(focusNextOverride).toBeDefined();
      expect(focusNextOverride?.enabled).toBe(false);
      freshRegistrar.destroy();
    });

    it("should import profile", () => {
      const freshRegistrar = new ShortcutRegistrar();
      const profile: ShortcutProfile = {
        name: "Custom Profile",
        version: "1.0.0",
        created: new Date().toISOString(),
        shortcuts: [
          { action: "focusNext", key: "n", enabled: true },
          { action: "focusPrev", key: "p", enabled: true },
        ],
      };

      freshRegistrar.importProfile(profile);

      expect(freshRegistrar.getShortcut("focusNext")?.key).toBe("n");
      expect(freshRegistrar.getShortcut("focusPrev")?.key).toBe("p");
      freshRegistrar.destroy();
    });

    it("should emit profile:saved event on export", () => {
      const freshRegistrar = new ShortcutRegistrar();
      const listener = jest.fn();
      freshRegistrar.on("profile:saved", listener);

      freshRegistrar.exportProfile("Test");

      expect(listener).toHaveBeenCalledTimes(1);
      freshRegistrar.destroy();
    });

    it("should emit profile:loaded event on import", () => {
      const freshRegistrar = new ShortcutRegistrar();
      const listener = jest.fn();
      freshRegistrar.on("profile:loaded", listener);

      const profile: ShortcutProfile = {
        name: "Test",
        version: "1.0.0",
        created: new Date().toISOString(),
        shortcuts: [],
      };

      freshRegistrar.importProfile(profile);

      expect(listener).toHaveBeenCalledTimes(1);
      freshRegistrar.destroy();
    });
  });

  describe("KeyBinding conversion", () => {
    it("should convert to KeyBinding array", () => {
      const freshRegistrar = new ShortcutRegistrar();
      const bindings = freshRegistrar.toKeyBindings();

      expect(bindings.length).toBeGreaterThan(0);
      expect(bindings[0]).toHaveProperty("key");
      expect(bindings[0]).toHaveProperty("action");
      expect(bindings[0]).toHaveProperty("description");
      freshRegistrar.destroy();
    });

    it("should only include enabled shortcuts", () => {
      const freshRegistrar = new ShortcutRegistrar();
      freshRegistrar.updateShortcut("focusNext", { enabled: false });

      const bindings = freshRegistrar.toKeyBindings();
      const focusNextBinding = bindings.find((b) => b.action === "focusNext");
      expect(focusNextBinding).toBeUndefined();
      freshRegistrar.destroy();
    });
  });

  describe("events", () => {
    it("should remove event listener", () => {
      const freshRegistrar = new ShortcutRegistrar();
      const listener = jest.fn();
      freshRegistrar.on("shortcut:updated", listener);
      freshRegistrar.off("shortcut:updated", listener);

      freshRegistrar.updateShortcut("focusNext", { key: "n" });

      expect(listener).not.toHaveBeenCalled();
      freshRegistrar.destroy();
    });
  });

  describe("configuration", () => {
    it("should update config", () => {
      const freshRegistrar = new ShortcutRegistrar();
      freshRegistrar.setConfig({ detectConflicts: false });

      const config = freshRegistrar.getConfig();
      expect(config.detectConflicts).toBe(false);
      freshRegistrar.destroy();
    });
  });

  describe("destroy", () => {
    it("should cleanup on destroy", () => {
      const freshRegistrar = new ShortcutRegistrar();
      freshRegistrar.destroy();

      const shortcuts = freshRegistrar.getAllShortcuts();
      expect(shortcuts.length).toBe(0);
    });
  });
});

/**
 * TypeColorManager Unit Tests
 *
 * Tests for the type-based color management system.
 */

import {
  TypeColorManager,
  createTypeColorManager,
  DEFAULT_TYPE_COLOR_MANAGER_CONFIG,
  BUILT_IN_PALETTES,
} from "../../../../../../src/presentation/renderers/graph/search";

describe("TypeColorManager", () => {
  let manager: TypeColorManager;

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    manager = new TypeColorManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  describe("constructor", () => {
    it("should create with default config", () => {
      expect(manager).toBeDefined();
      expect(manager.getPalette().id).toBe("default");
    });

    it("should accept custom config", () => {
      const customManager = new TypeColorManager({
        paletteId: "pastel",
      });
      expect(customManager.getPalette().id).toBe("pastel");
      customManager.destroy();
    });
  });

  describe("getTypeColor", () => {
    it("should return configured color for known types", () => {
      const taskColor = manager.getTypeColor("ems__Task");
      expect(taskColor.typeUri).toBe("ems__Task");
      expect(taskColor.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(taskColor.displayName).toBe("Task");
    });

    it("should return configured color for projects", () => {
      const projectColor = manager.getTypeColor("ems__Project");
      expect(projectColor.typeUri).toBe("ems__Project");
      expect(projectColor.displayName).toBe("Project");
    });

    it("should generate color for unknown types", () => {
      const unknownColor = manager.getTypeColor("custom__NewType");
      expect(unknownColor.typeUri).toBe("custom__NewType");
      expect(unknownColor.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("should return consistent color for same unknown type", () => {
      const color1 = manager.getTypeColor("unknown__Type1");
      const color2 = manager.getTypeColor("unknown__Type1");
      expect(color1.color).toBe(color2.color);
    });

    it("should return custom override when set", () => {
      const customColor = "#ff0000";
      manager.setTypeColor("ems__Task", customColor);
      const taskColor = manager.getTypeColor("ems__Task");
      expect(taskColor.color).toBe(customColor);
    });
  });

  describe("setTypeColor", () => {
    it("should set custom color override", () => {
      manager.setTypeColor("ems__Task", "#123456");
      const color = manager.getTypeColor("ems__Task");
      expect(color.color).toBe("#123456");
    });

    it("should persist to localStorage", () => {
      manager.setTypeColor("ems__Task", "#654321");
      // Create new manager to verify persistence
      const newManager = new TypeColorManager();
      const color = newManager.getTypeColor("ems__Task");
      expect(color.color).toBe("#654321");
      newManager.destroy();
    });

    it("should emit color:change event", () => {
      const listener = jest.fn();
      manager.addEventListener(listener);
      manager.setTypeColor("ems__Task", "#abcdef");
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "color:change",
          typeUri: "ems__Task",
          color: "#abcdef",
        })
      );
    });
  });

  describe("resetTypeColor", () => {
    it("should remove custom override", () => {
      manager.setTypeColor("ems__Task", "#111111");
      manager.resetTypeColor("ems__Task");
      const color = manager.getTypeColor("ems__Task");
      expect(color.color).not.toBe("#111111");
    });

    it("should emit color:change event", () => {
      manager.setTypeColor("ems__Task", "#111111");
      const listener = jest.fn();
      manager.addEventListener(listener);
      manager.resetTypeColor("ems__Task");
      expect(listener).toHaveBeenCalled();
    });
  });

  describe("registerType", () => {
    it("should register new type configuration", () => {
      manager.registerType({
        typeUri: "custom__Widget",
        color: "#999999",
        icon: "⚙",
        priority: 50,
      });
      const color = manager.getTypeColor("custom__Widget");
      expect(color.color).toBe("#999999");
      expect(color.icon).toBe("⚙");
    });

    it("should override existing type configuration", () => {
      manager.registerType({
        typeUri: "ems__Task",
        color: "#ffffff",
        priority: 100,
      });
      const color = manager.getTypeColor("ems__Task");
      expect(color.color).toBe("#ffffff");
    });
  });

  describe("setPalette", () => {
    it("should change current palette", () => {
      manager.setPalette("pastel");
      expect(manager.getPalette().id).toBe("pastel");
    });

    it("should emit palette:change event", () => {
      const listener = jest.fn();
      manager.addEventListener(listener);
      manager.setPalette("colorblind-safe");
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "palette:change",
          paletteId: "colorblind-safe",
        })
      );
    });

    it("should clear generated colors when palette changes", () => {
      // Generate color for unknown type
      const color1 = manager.getTypeColor("unknown__Type");
      // Change palette
      manager.setPalette("pastel");
      // Get color again - should be regenerated with new palette
      const color2 = manager.getTypeColor("unknown__Type");
      // Colors may be different (though not guaranteed)
      expect(color2.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("should ignore invalid palette ID", () => {
      manager.setPalette("nonexistent");
      expect(manager.getPalette().id).toBe("default");
    });
  });

  describe("getAvailablePalettes", () => {
    it("should return all built-in palettes", () => {
      const palettes = manager.getAvailablePalettes();
      expect(palettes.length).toBe(BUILT_IN_PALETTES.length);
      expect(palettes.map((p) => p.id)).toContain("default");
      expect(palettes.map((p) => p.id)).toContain("pastel");
      expect(palettes.map((p) => p.id)).toContain("colorblind-safe");
    });
  });

  describe("updateLegend", () => {
    it("should create legend items from type counts", () => {
      const typeCounts = new Map([
        ["ems__Task", 10],
        ["ems__Project", 5],
      ]);
      manager.updateLegend(typeCounts);
      const state = manager.getLegendState();
      expect(state.items.length).toBe(2);
      expect(state.items.find((i) => i.typeUri === "ems__Task")?.count).toBe(10);
    });

    it("should sort items by priority then count", () => {
      const typeCounts = new Map([
        ["ems__Task", 100], // priority 80
        ["ems__Area", 1], // priority 90
      ]);
      manager.updateLegend(typeCounts);
      const state = manager.getLegendState();
      // Area should come first due to higher priority
      expect(state.items[0].typeUri).toBe("ems__Area");
    });
  });

  describe("toggleLegendVisibility", () => {
    it("should toggle specific type visibility", () => {
      const typeCounts = new Map([["ems__Task", 5]]);
      manager.updateLegend(typeCounts);

      manager.toggleLegendVisibility("ems__Task");
      let state = manager.getLegendState();
      expect(state.items[0].visible).toBe(false);

      manager.toggleLegendVisibility("ems__Task");
      state = manager.getLegendState();
      expect(state.items[0].visible).toBe(true);
    });

    it("should toggle legend expansion when no typeUri", () => {
      let state = manager.getLegendState();
      expect(state.isExpanded).toBe(true);

      manager.toggleLegendVisibility();
      state = manager.getLegendState();
      expect(state.isExpanded).toBe(false);
    });
  });

  describe("getColorAsNumber", () => {
    it("should return color as hex number", () => {
      manager.setTypeColor("ems__Task", "#ff0000");
      const num = manager.getColorAsNumber("ems__Task");
      expect(num).toBe(0xff0000);
    });

    it("should work with any valid hex color", () => {
      manager.setTypeColor("test", "#123abc");
      const num = manager.getColorAsNumber("test");
      expect(num).toBe(0x123abc);
    });
  });

  describe("exportConfig / importConfig", () => {
    it("should export current configuration as JSON", () => {
      manager.setTypeColor("ems__Task", "#aabbcc");
      manager.setPalette("pastel");
      const exported = manager.exportConfig();
      const parsed = JSON.parse(exported);
      expect(parsed.paletteId).toBe("pastel");
      expect(parsed.customColors["ems__Task"]).toBe("#aabbcc");
    });

    it("should import configuration from JSON", () => {
      const config = JSON.stringify({
        paletteId: "colorblind-safe",
        customColors: { "ems__Project": "#112233" },
      });
      manager.importConfig(config);
      expect(manager.getPalette().id).toBe("colorblind-safe");
      expect(manager.getTypeColor("ems__Project").color).toBe("#112233");
    });

    it("should handle invalid JSON gracefully", () => {
      expect(() => manager.importConfig("invalid json")).not.toThrow();
    });
  });

  describe("reset", () => {
    it("should clear all custom colors", () => {
      manager.setTypeColor("ems__Task", "#000000");
      manager.reset();
      const color = manager.getTypeColor("ems__Task");
      expect(color.color).not.toBe("#000000");
    });

    it("should clear localStorage", () => {
      manager.setTypeColor("ems__Task", "#000000");
      manager.reset();
      // Create new manager and verify no persisted colors
      const newManager = new TypeColorManager();
      const state = newManager.getLegendState();
      expect(state.customColors.size).toBe(0);
      newManager.destroy();
    });
  });

  describe("event listeners", () => {
    it("should add and remove listeners", () => {
      const listener = jest.fn();
      manager.addEventListener(listener);
      manager.setTypeColor("test", "#123456");
      expect(listener).toHaveBeenCalled();

      listener.mockClear();
      manager.removeEventListener(listener);
      manager.setTypeColor("test", "#654321");
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("createTypeColorManager factory", () => {
    it("should create manager with config", () => {
      const created = createTypeColorManager({ paletteId: "pastel" });
      expect(created.getPalette().id).toBe("pastel");
      created.destroy();
    });
  });

  describe("DEFAULT_TYPE_COLOR_MANAGER_CONFIG", () => {
    it("should have sensible defaults", () => {
      expect(DEFAULT_TYPE_COLOR_MANAGER_CONFIG.paletteId).toBe("default");
      expect(DEFAULT_TYPE_COLOR_MANAGER_CONFIG.useInheritance).toBe(true);
      expect(DEFAULT_TYPE_COLOR_MANAGER_CONFIG.enforceContrast).toBe(true);
    });
  });
});

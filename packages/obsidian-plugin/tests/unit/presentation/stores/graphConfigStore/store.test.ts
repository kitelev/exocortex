/**
 * Unit tests for GraphConfigStore
 */

import { act } from "@testing-library/react";
import {
  useGraphConfigStore,
  getDefaultState,
  getDefaultConfig,
} from "../../../../../src/presentation/stores/graphConfigStore/store";
import {
  BUILT_IN_PRESETS,
  PERFORMANCE_PRESET,
  QUALITY_PRESET,
} from "../../../../../src/presentation/stores/graphConfigStore/presets";
import type { GraphConfig } from "../../../../../src/presentation/stores/graphConfigStore/types";

// Mock localStorage
const localStorageMock = {
  store: {} as Record<string, string>,
  getItem: jest.fn((key: string) => localStorageMock.store[key] || null),
  setItem: jest.fn((key: string, value: string) => {
    localStorageMock.store[key] = value;
  }),
  removeItem: jest.fn((key: string) => {
    delete localStorageMock.store[key];
  }),
  clear: jest.fn(() => {
    localStorageMock.store = {};
  }),
};

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

/**
 * Stringify object handling Infinity values (same format as store's exportConfig)
 */
function stringifyWithInfinity(obj: unknown): string {
  return JSON.stringify(obj, (_, value) => {
    if (value === Infinity) return "__INFINITY__";
    if (value === -Infinity) return "__NEG_INFINITY__";
    return value;
  });
}

/**
 * Reset store state before each test
 */
function resetStoreForTest(): void {
  localStorageMock.clear();

  useGraphConfigStore.setState({
    config: getDefaultConfig(),
    activePreset: null,
    customPresets: [],
  });
}

describe("GraphConfigStore", () => {
  beforeEach(() => {
    resetStoreForTest();
  });

  describe("getDefaultState", () => {
    it("returns valid default state", () => {
      const state = getDefaultState();

      expect(state.config).toBeDefined();
      expect(state.activePreset).toBeNull();
      expect(state.customPresets).toEqual([]);
    });

    it("returns default config with all sections", () => {
      const state = getDefaultState();

      expect(state.config.physics).toBeDefined();
      expect(state.config.rendering).toBeDefined();
      expect(state.config.interaction).toBeDefined();
      expect(state.config.filters).toBeDefined();
      expect(state.config.layout).toBeDefined();
      expect(state.config.minimap).toBeDefined();
    });
  });

  describe("getDefaultConfig", () => {
    it("returns physics defaults", () => {
      const config = getDefaultConfig();

      expect(config.physics.enabled).toBe(true);
      expect(config.physics.simulation.alphaMin).toBe(0.001);
      expect(config.physics.simulation.alphaDecay).toBe(0.0228);
      expect(config.physics.charge.strength).toBe(-300);
      expect(config.physics.link.distance).toBe(100);
    });

    it("returns rendering defaults", () => {
      const config = getDefaultConfig();

      expect(config.rendering.performance.maxFPS).toBe(60);
      expect(config.rendering.performance.antialias).toBe(true);
      expect(config.rendering.nodes.defaultRadius).toBe(8);
      expect(config.rendering.edges.opacity).toBe(0.6);
    });

    it("returns interaction defaults", () => {
      const config = getDefaultConfig();

      expect(config.interaction.zoom.enabled).toBe(true);
      expect(config.interaction.zoom.min).toBe(0.1);
      expect(config.interaction.zoom.max).toBe(10);
      expect(config.interaction.drag.threshold).toBe(5);
    });
  });

  describe("get", () => {
    it("returns complete config when no path specified", () => {
      const store = useGraphConfigStore.getState();
      const config = store.get();

      expect(config).toEqual(store.config);
    });

    it("returns nested value at path", () => {
      const store = useGraphConfigStore.getState();
      const maxFPS = store.get<number>("rendering.performance.maxFPS");

      expect(maxFPS).toBe(60);
    });

    it("returns undefined for invalid path", () => {
      const store = useGraphConfigStore.getState();
      const value = store.get("invalid.path.here");

      expect(value).toBeUndefined();
    });

    it("returns deep cloned object", () => {
      const store = useGraphConfigStore.getState();
      const config1 = store.get();
      const config2 = store.get();

      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });

  describe("set", () => {
    it("updates nested config with deep merge", () => {
      act(() => {
        useGraphConfigStore.getState().set({
          physics: { enabled: false },
        });
      });

      const config = useGraphConfigStore.getState().config;
      expect(config.physics.enabled).toBe(false);
      // Other physics properties should be preserved
      expect(config.physics.charge.strength).toBe(-300);
    });

    it("updates deeply nested properties", () => {
      act(() => {
        useGraphConfigStore.getState().set({
          rendering: {
            performance: { maxFPS: 30 },
          },
        });
      });

      const config = useGraphConfigStore.getState().config;
      expect(config.rendering.performance.maxFPS).toBe(30);
      expect(config.rendering.performance.antialias).toBe(true);
    });

    it("clears active preset after manual modification", () => {
      // First apply a preset
      act(() => {
        useGraphConfigStore.getState().applyPreset("performance");
      });
      expect(useGraphConfigStore.getState().activePreset).toBe("performance");

      // Then modify config
      act(() => {
        useGraphConfigStore.getState().set({
          physics: { enabled: false },
        });
      });

      expect(useGraphConfigStore.getState().activePreset).toBeNull();
    });
  });

  describe("reset", () => {
    it("resets entire config to defaults", () => {
      // Modify config
      act(() => {
        useGraphConfigStore.getState().set({
          physics: { enabled: false },
          rendering: { performance: { maxFPS: 30 } },
        });
      });

      // Reset
      act(() => {
        useGraphConfigStore.getState().reset();
      });

      const config = useGraphConfigStore.getState().config;
      expect(config.physics.enabled).toBe(true);
      expect(config.rendering.performance.maxFPS).toBe(60);
    });

    it("resets specific path only", () => {
      // Modify multiple sections
      act(() => {
        useGraphConfigStore.getState().set({
          physics: { enabled: false },
          rendering: { performance: { maxFPS: 30 } },
        });
      });

      // Reset only physics
      act(() => {
        useGraphConfigStore.getState().reset("physics");
      });

      const config = useGraphConfigStore.getState().config;
      expect(config.physics.enabled).toBe(true); // Reset
      expect(config.rendering.performance.maxFPS).toBe(30); // Unchanged
    });

    it("clears active preset", () => {
      act(() => {
        useGraphConfigStore.getState().applyPreset("quality");
      });
      expect(useGraphConfigStore.getState().activePreset).toBe("quality");

      act(() => {
        useGraphConfigStore.getState().reset();
      });
      expect(useGraphConfigStore.getState().activePreset).toBeNull();
    });
  });

  describe("applyPreset", () => {
    it("applies built-in preset", () => {
      act(() => {
        useGraphConfigStore.getState().applyPreset("performance");
      });

      const state = useGraphConfigStore.getState();
      expect(state.activePreset).toBe("performance");
      expect(state.config.rendering.performance.maxFPS).toBe(30);
    });

    it("applies preset on top of defaults", () => {
      act(() => {
        useGraphConfigStore.getState().applyPreset("performance");
      });

      const config = useGraphConfigStore.getState().config;
      // Preset override
      expect(config.rendering.performance.maxFPS).toBe(30);
      // Default values preserved
      expect(config.physics.charge.strength).toBe(-300);
    });

    it("applies custom preset", () => {
      // First save a custom preset
      act(() => {
        useGraphConfigStore.getState().set({
          physics: { charge: { strength: -500 } },
        });
        useGraphConfigStore.getState().saveAsPreset("my-preset", "Test preset");
      });

      // Reset and apply custom preset
      act(() => {
        useGraphConfigStore.getState().reset();
        useGraphConfigStore.getState().applyPreset("my-preset");
      });

      const state = useGraphConfigStore.getState();
      expect(state.activePreset).toBe("my-preset");
      expect(state.config.physics.charge.strength).toBe(-500);
    });

    it("warns for unknown preset", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();

      act(() => {
        useGraphConfigStore.getState().applyPreset("nonexistent");
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Preset \"nonexistent\" not found")
      );
      warnSpy.mockRestore();
    });
  });

  describe("saveAsPreset", () => {
    it("saves current config as custom preset", () => {
      act(() => {
        useGraphConfigStore.getState().set({
          physics: { charge: { strength: -500 } },
        });
        useGraphConfigStore.getState().saveAsPreset("my-preset", "My custom preset");
      });

      const state = useGraphConfigStore.getState();
      expect(state.customPresets).toHaveLength(1);
      expect(state.customPresets[0].name).toBe("my-preset");
      expect(state.customPresets[0].description).toBe("My custom preset");
      expect(state.activePreset).toBe("my-preset");
    });

    it("updates existing custom preset", () => {
      act(() => {
        useGraphConfigStore.getState().saveAsPreset("my-preset", "Version 1");
      });

      act(() => {
        useGraphConfigStore.getState().set({
          physics: { enabled: false },
        });
        useGraphConfigStore.getState().saveAsPreset("my-preset", "Version 2");
      });

      const state = useGraphConfigStore.getState();
      expect(state.customPresets).toHaveLength(1);
      expect(state.customPresets[0].description).toBe("Version 2");
    });

    it("prevents overwriting built-in preset", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();

      act(() => {
        useGraphConfigStore.getState().saveAsPreset("performance", "Overwrite attempt");
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot overwrite built-in preset "performance"')
      );
      expect(useGraphConfigStore.getState().customPresets).toHaveLength(0);
      warnSpy.mockRestore();
    });
  });

  describe("deletePreset", () => {
    it("deletes custom preset", () => {
      act(() => {
        useGraphConfigStore.getState().saveAsPreset("my-preset");
      });
      expect(useGraphConfigStore.getState().customPresets).toHaveLength(1);

      act(() => {
        useGraphConfigStore.getState().deletePreset("my-preset");
      });
      expect(useGraphConfigStore.getState().customPresets).toHaveLength(0);
    });

    it("clears activePreset if deleting active", () => {
      act(() => {
        useGraphConfigStore.getState().saveAsPreset("my-preset");
      });
      expect(useGraphConfigStore.getState().activePreset).toBe("my-preset");

      act(() => {
        useGraphConfigStore.getState().deletePreset("my-preset");
      });
      expect(useGraphConfigStore.getState().activePreset).toBeNull();
    });

    it("prevents deleting built-in preset", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();

      act(() => {
        useGraphConfigStore.getState().deletePreset("performance");
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot delete built-in preset "performance"')
      );
      warnSpy.mockRestore();
    });
  });

  describe("getPresets", () => {
    it("returns all built-in presets", () => {
      const presets = useGraphConfigStore.getState().getPresets();

      expect(presets.length).toBeGreaterThanOrEqual(BUILT_IN_PRESETS.length);
      expect(presets.some((p) => p.name === "performance")).toBe(true);
      expect(presets.some((p) => p.name === "quality")).toBe(true);
      expect(presets.some((p) => p.name === "dense")).toBe(true);
    });

    it("includes custom presets", () => {
      act(() => {
        useGraphConfigStore.getState().saveAsPreset("custom1");
        useGraphConfigStore.getState().saveAsPreset("custom2");
      });

      const presets = useGraphConfigStore.getState().getPresets();
      expect(presets.some((p) => p.name === "custom1")).toBe(true);
      expect(presets.some((p) => p.name === "custom2")).toBe(true);
    });
  });

  describe("exportConfig / importConfig", () => {
    it("exports config as JSON string", () => {
      act(() => {
        useGraphConfigStore.getState().set({
          physics: { charge: { strength: -500 } },
        });
        useGraphConfigStore.getState().saveAsPreset("my-preset");
      });

      const json = useGraphConfigStore.getState().exportConfig();
      const parsed = JSON.parse(json);

      expect(parsed.config).toBeDefined();
      expect(parsed.config.physics.charge.strength).toBe(-500);
      expect(parsed.customPresets).toHaveLength(1);
    });

    it("imports valid config", () => {
      const exportedConfig = {
        config: {
          ...getDefaultConfig(),
          physics: {
            ...getDefaultConfig().physics,
            enabled: false,
          },
        },
        customPresets: [{ name: "imported", description: "Imported preset", config: {} }],
      };

      let result: boolean;
      act(() => {
        // Use stringifyWithInfinity to handle Infinity values in distanceMax
        result = useGraphConfigStore.getState().importConfig(stringifyWithInfinity(exportedConfig));
      });

      expect(result!).toBe(true);
      expect(useGraphConfigStore.getState().config.physics.enabled).toBe(false);
      expect(useGraphConfigStore.getState().customPresets).toHaveLength(1);
    });

    it("rejects invalid JSON", () => {
      const errorSpy = jest.spyOn(console, "error").mockImplementation();

      let result: boolean;
      act(() => {
        result = useGraphConfigStore.getState().importConfig("not valid json");
      });

      expect(result!).toBe(false);
      errorSpy.mockRestore();
    });

    it("filters out built-in preset names from import", () => {
      const exportedConfig = {
        config: getDefaultConfig(),
        customPresets: [
          { name: "performance", description: "Try to overwrite", config: {} }, // Should be filtered
          { name: "my-preset", description: "Valid", config: {} },
        ],
      };

      act(() => {
        // Use stringifyWithInfinity to handle Infinity values in distanceMax
        useGraphConfigStore.getState().importConfig(stringifyWithInfinity(exportedConfig));
      });

      const customPresets = useGraphConfigStore.getState().customPresets;
      expect(customPresets).toHaveLength(1);
      expect(customPresets[0].name).toBe("my-preset");
    });
  });

  describe("subscribe", () => {
    it("calls callback when config changes", () => {
      const callback = jest.fn();
      const unsubscribe = useGraphConfigStore.getState().subscribe(callback);

      act(() => {
        useGraphConfigStore.getState().set({
          physics: { enabled: false },
        });
      });

      expect(callback).toHaveBeenCalled();
      expect(callback.mock.calls[0][0].physics.enabled).toBe(false);

      unsubscribe();
    });

    it("returns unsubscribe function", () => {
      const callback = jest.fn();
      const unsubscribe = useGraphConfigStore.getState().subscribe(callback);

      unsubscribe();

      act(() => {
        useGraphConfigStore.getState().set({
          physics: { enabled: false },
        });
      });

      expect(callback).not.toHaveBeenCalled();
    });
  });
});

describe("Built-in Presets", () => {
  beforeEach(() => {
    resetStoreForTest();
  });

  it("has at least 5 presets", () => {
    expect(BUILT_IN_PRESETS.length).toBeGreaterThanOrEqual(5);
  });

  it("performance preset reduces quality for speed", () => {
    expect(PERFORMANCE_PRESET.config.rendering?.performance?.maxFPS).toBe(30);
    expect(PERFORMANCE_PRESET.config.rendering?.performance?.antialias).toBe(false);
    expect(PERFORMANCE_PRESET.config.minimap?.enabled).toBe(false);
  });

  it("quality preset enables high quality rendering", () => {
    expect(QUALITY_PRESET.config.rendering?.performance?.maxFPS).toBe(60);
    expect(QUALITY_PRESET.config.rendering?.performance?.pixelRatio).toBe(2);
    expect(QUALITY_PRESET.config.rendering?.performance?.antialias).toBe(true);
  });

  it("all presets have name and description", () => {
    for (const preset of BUILT_IN_PRESETS) {
      expect(preset.name).toBeTruthy();
      expect(typeof preset.name).toBe("string");
      expect(preset.description).toBeTruthy();
      expect(typeof preset.description).toBe("string");
    }
  });
});

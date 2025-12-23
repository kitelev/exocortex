/**
 * Unit tests for GraphConfig hooks
 */

import { renderHook, act } from "@testing-library/react";
import {
  useGraphConfigStore,
  getDefaultConfig,
} from "../../../../../src/presentation/stores/graphConfigStore/store";
import {
  useGraphConfig,
  useGraphConfigSection,
  usePhysicsConfig,
  useRenderingConfig,
  useInteractionConfig,
  useFilterConfig,
  useLayoutConfig,
  useMinimapConfig,
  useConfigValue,
  useSetConfig,
  useResetConfig,
  useConfigState,
  usePresets,
  useConfigImportExport,
  useConfigSubscription,
  usePhysicsSettings,
  useRenderingSettings,
} from "../../../../../src/presentation/stores/graphConfigStore/hooks";

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
 * Reset store state before each test
 */
function resetStoreForTest(): void {
  localStorageMock.clear();
  // Reset store to default state
  useGraphConfigStore.setState({
    config: getDefaultConfig(),
    activePreset: null,
    customPresets: [],
  });
}

describe("GraphConfig Hooks", () => {
  beforeEach(() => {
    resetStoreForTest();
  });

  describe("useGraphConfig", () => {
    it("returns complete configuration", () => {
      const { result } = renderHook(() => useGraphConfig());

      expect(result.current.physics).toBeDefined();
      expect(result.current.rendering).toBeDefined();
      expect(result.current.interaction).toBeDefined();
    });
  });

  describe("useGraphConfigSection", () => {
    it("returns physics section", () => {
      const { result } = renderHook(() => useGraphConfigSection("physics"));

      expect(result.current.enabled).toBe(true);
      expect(result.current.charge.strength).toBe(-300);
    });

    it("returns rendering section", () => {
      const { result } = renderHook(() => useGraphConfigSection("rendering"));

      expect(result.current.performance.maxFPS).toBe(60);
    });
  });

  describe("usePhysicsConfig", () => {
    it("returns physics configuration", () => {
      const { result } = renderHook(() => usePhysicsConfig());

      expect(result.current.enabled).toBe(true);
      expect(result.current.simulation.alphaMin).toBe(0.001);
    });
  });

  describe("useRenderingConfig", () => {
    it("returns rendering configuration", () => {
      const { result } = renderHook(() => useRenderingConfig());

      expect(result.current.performance.maxFPS).toBe(60);
      expect(result.current.nodes.defaultRadius).toBe(8);
    });
  });

  describe("useInteractionConfig", () => {
    it("returns interaction configuration", () => {
      const { result } = renderHook(() => useInteractionConfig());

      expect(result.current.zoom.enabled).toBe(true);
      expect(result.current.drag.threshold).toBe(5);
    });
  });

  describe("useFilterConfig", () => {
    it("returns filter configuration", () => {
      const { result } = renderHook(() => useFilterConfig());

      expect(result.current.showOrphans).toBe(true);
      expect(result.current.nodeTypes).toEqual([]);
    });
  });

  describe("useLayoutConfig", () => {
    it("returns layout configuration", () => {
      const { result } = renderHook(() => useLayoutConfig());

      expect(result.current.defaultAlgorithm).toBe("force");
      expect(result.current.hierarchical.direction).toBe("TB");
    });
  });

  describe("useMinimapConfig", () => {
    it("returns minimap configuration", () => {
      const { result } = renderHook(() => useMinimapConfig());

      expect(result.current.enabled).toBe(true);
      expect(result.current.position).toBe("bottom-right");
    });
  });

  describe("useConfigValue", () => {
    it("returns specific config value by path", () => {
      const { result } = renderHook(() =>
        useConfigValue<number>("physics.charge.strength")
      );

      expect(result.current).toBe(-300);
    });

    it("returns nested value", () => {
      const { result } = renderHook(() =>
        useConfigValue<boolean>("rendering.performance.antialias")
      );

      expect(result.current).toBe(true);
    });
  });

  describe("useSetConfig", () => {
    it("returns set function", () => {
      const { result } = renderHook(() => useSetConfig());

      act(() => {
        result.current({ physics: { enabled: false } });
      });

      expect(useGraphConfigStore.getState().config.physics.enabled).toBe(false);
    });
  });

  describe("useResetConfig", () => {
    it("returns reset function", () => {
      const { result } = renderHook(() => useResetConfig());

      // Modify config first
      act(() => {
        useGraphConfigStore.getState().set({ physics: { enabled: false } });
      });
      expect(useGraphConfigStore.getState().config.physics.enabled).toBe(false);

      // Reset
      act(() => {
        result.current();
      });

      expect(useGraphConfigStore.getState().config.physics.enabled).toBe(true);
    });
  });

  describe("useConfigState", () => {
    it("returns section value and setter tuple", () => {
      const { result } = renderHook(() => useConfigState("physics"));

      const [physics, setPhysics] = result.current;
      expect(physics.enabled).toBe(true);
      expect(typeof setPhysics).toBe("function");
    });

    it("updates section value with setter", () => {
      const { result } = renderHook(() => useConfigState("physics"));

      act(() => {
        const [, setPhysics] = result.current;
        setPhysics({ enabled: false });
      });

      expect(useGraphConfigStore.getState().config.physics.enabled).toBe(false);
    });
  });

  describe("usePresets", () => {
    it("returns preset management functions", () => {
      const { result } = renderHook(() => usePresets());

      expect(result.current.activePreset).toBeNull();
      expect(result.current.presets.length).toBeGreaterThan(0);
      expect(typeof result.current.applyPreset).toBe("function");
      expect(typeof result.current.saveAsPreset).toBe("function");
      expect(typeof result.current.deletePreset).toBe("function");
    });

    it("applies preset", () => {
      const { result } = renderHook(() => usePresets());

      act(() => {
        result.current.applyPreset("performance");
      });

      expect(useGraphConfigStore.getState().activePreset).toBe("performance");
    });
  });

  describe("useConfigImportExport", () => {
    it("returns import/export functions", () => {
      const { result } = renderHook(() => useConfigImportExport());

      expect(typeof result.current.exportConfig).toBe("function");
      expect(typeof result.current.importConfig).toBe("function");
    });

    it("exports configuration as JSON", () => {
      const { result } = renderHook(() => useConfigImportExport());

      const json = result.current.exportConfig();
      const parsed = JSON.parse(json);

      expect(parsed.config).toBeDefined();
      expect(parsed.customPresets).toBeDefined();
    });
  });

  describe("useConfigSubscription", () => {
    it("calls callback on config change", () => {
      const callback = jest.fn();
      const selector = (config: { physics: { enabled: boolean } }) => config.physics.enabled;
      const { unmount } = renderHook(() => useConfigSubscription(selector, callback));

      act(() => {
        useGraphConfigStore.getState().set({ physics: { enabled: false } });
      });

      expect(callback).toHaveBeenCalledWith(false);

      // Cleanup - useEffect handles unsubscription on unmount
      unmount();
    });
  });

  describe("usePhysicsSettings", () => {
    it("returns physics config and setters", () => {
      const { result } = renderHook(() => usePhysicsSettings());

      expect(result.current.physics.enabled).toBe(true);
      expect(result.current.physics.charge.strength).toBe(-300);
      expect(typeof result.current.setPhysicsEnabled).toBe("function");
      expect(typeof result.current.setChargeStrength).toBe("function");
    });

    it("sets physics enabled", () => {
      const { result } = renderHook(() => usePhysicsSettings());

      act(() => {
        result.current.setPhysicsEnabled(false);
      });

      expect(useGraphConfigStore.getState().config.physics.enabled).toBe(false);
    });

    it("sets charge strength", () => {
      const { result } = renderHook(() => usePhysicsSettings());

      act(() => {
        result.current.setChargeStrength(-500);
      });

      expect(useGraphConfigStore.getState().config.physics.charge.strength).toBe(-500);
    });

    it("sets link distance", () => {
      const { result } = renderHook(() => usePhysicsSettings());

      act(() => {
        result.current.setLinkDistance(150);
      });

      expect(useGraphConfigStore.getState().config.physics.link.distance).toBe(150);
    });

    it("sets collision enabled", () => {
      const { result } = renderHook(() => usePhysicsSettings());

      act(() => {
        result.current.setCollisionEnabled(false);
      });

      expect(useGraphConfigStore.getState().config.physics.collision.enabled).toBe(false);
    });
  });

  describe("useRenderingSettings", () => {
    it("returns rendering config and setters", () => {
      const { result } = renderHook(() => useRenderingSettings());

      expect(result.current.rendering.performance.maxFPS).toBe(60);
      expect(result.current.rendering.performance.antialias).toBe(true);
      expect(typeof result.current.setMaxFPS).toBe("function");
      expect(typeof result.current.setAntialias).toBe("function");
    });

    it("sets max FPS", () => {
      const { result } = renderHook(() => useRenderingSettings());

      act(() => {
        result.current.setMaxFPS(30);
      });

      expect(useGraphConfigStore.getState().config.rendering.performance.maxFPS).toBe(30);
    });

    it("sets antialias", () => {
      const { result } = renderHook(() => useRenderingSettings());

      act(() => {
        result.current.setAntialias(false);
      });

      expect(useGraphConfigStore.getState().config.rendering.performance.antialias).toBe(false);
    });

    it("sets node radius", () => {
      const { result } = renderHook(() => useRenderingSettings());

      act(() => {
        result.current.setNodeRadius(12);
      });

      expect(useGraphConfigStore.getState().config.rendering.nodes.defaultRadius).toBe(12);
    });

    it("sets show labels threshold", () => {
      const { result } = renderHook(() => useRenderingSettings());

      act(() => {
        result.current.setShowLabels(1.0);
      });

      expect(useGraphConfigStore.getState().config.rendering.labels.showThreshold).toBe(1.0);
    });

    it("sets show grid", () => {
      const { result } = renderHook(() => useRenderingSettings());

      act(() => {
        result.current.setShowGrid(true);
      });

      expect(useGraphConfigStore.getState().config.rendering.background.showGrid).toBe(true);
    });
  });
});

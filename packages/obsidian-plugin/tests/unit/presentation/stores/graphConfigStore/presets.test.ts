/**
 * Unit tests for GraphConfig presets
 */

import {
  BUILT_IN_PRESETS,
  PERFORMANCE_PRESET,
  QUALITY_PRESET,
  DENSE_PRESET,
  HIERARCHICAL_PRESET,
  ACCESSIBILITY_PRESET,
  RADIAL_PRESET,
  COMPACT_PRESET,
  getBuiltInPreset,
  isBuiltInPreset,
} from "../../../../../src/presentation/stores/graphConfigStore/presets";

describe("Built-in Presets", () => {
  describe("BUILT_IN_PRESETS array", () => {
    it("contains at least 7 presets", () => {
      expect(BUILT_IN_PRESETS.length).toBeGreaterThanOrEqual(7);
    });

    it("all presets have unique names", () => {
      const names = BUILT_IN_PRESETS.map((p) => p.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it("all presets have required fields", () => {
      for (const preset of BUILT_IN_PRESETS) {
        expect(preset.name).toBeTruthy();
        expect(typeof preset.name).toBe("string");
        expect(preset.description).toBeTruthy();
        expect(typeof preset.description).toBe("string");
        expect(preset.config).toBeDefined();
        expect(typeof preset.config).toBe("object");
      }
    });
  });

  describe("PERFORMANCE_PRESET", () => {
    it("has correct name", () => {
      expect(PERFORMANCE_PRESET.name).toBe("performance");
    });

    it("reduces maxFPS for performance", () => {
      expect(PERFORMANCE_PRESET.config.rendering?.performance?.maxFPS).toBe(30);
    });

    it("disables antialiasing", () => {
      expect(PERFORMANCE_PRESET.config.rendering?.performance?.antialias).toBe(false);
    });

    it("sets pixelRatio to 1", () => {
      expect(PERFORMANCE_PRESET.config.rendering?.performance?.pixelRatio).toBe(1);
    });

    it("disables shadows", () => {
      expect(PERFORMANCE_PRESET.config.rendering?.nodes?.showShadow).toBe(false);
    });

    it("disables minimap", () => {
      expect(PERFORMANCE_PRESET.config.minimap?.enabled).toBe(false);
    });

    it("disables collision detection", () => {
      expect(PERFORMANCE_PRESET.config.physics?.collision?.enabled).toBe(false);
    });
  });

  describe("QUALITY_PRESET", () => {
    it("has correct name", () => {
      expect(QUALITY_PRESET.name).toBe("quality");
    });

    it("sets maxFPS to 60", () => {
      expect(QUALITY_PRESET.config.rendering?.performance?.maxFPS).toBe(60);
    });

    it("sets pixelRatio to 2 for high DPI", () => {
      expect(QUALITY_PRESET.config.rendering?.performance?.pixelRatio).toBe(2);
    });

    it("enables antialiasing", () => {
      expect(QUALITY_PRESET.config.rendering?.performance?.antialias).toBe(true);
    });

    it("enables shadows", () => {
      expect(QUALITY_PRESET.config.rendering?.nodes?.showShadow).toBe(true);
    });

    it("enables minimap", () => {
      expect(QUALITY_PRESET.config.minimap?.enabled).toBe(true);
    });

    it("shows background grid", () => {
      expect(QUALITY_PRESET.config.rendering?.background?.showGrid).toBe(true);
    });
  });

  describe("DENSE_PRESET", () => {
    it("has correct name", () => {
      expect(DENSE_PRESET.name).toBe("dense");
    });

    it("increases charge strength for more repulsion", () => {
      expect(DENSE_PRESET.config.physics?.charge?.strength).toBe(-500);
    });

    it("increases link distance", () => {
      expect(DENSE_PRESET.config.physics?.link?.distance).toBe(150);
    });

    it("reduces link strength", () => {
      expect(DENSE_PRESET.config.physics?.link?.strength).toBe(0.5);
    });

    it("enables collision with higher strength", () => {
      expect(DENSE_PRESET.config.physics?.collision?.enabled).toBe(true);
      expect(DENSE_PRESET.config.physics?.collision?.strength).toBe(1);
    });

    it("hides orphan nodes", () => {
      expect(DENSE_PRESET.config.filters?.showOrphans).toBe(false);
    });

    it("requires minimum degree of 2", () => {
      expect(DENSE_PRESET.config.filters?.minDegree).toBe(2);
    });
  });

  describe("HIERARCHICAL_PRESET", () => {
    it("has correct name", () => {
      expect(HIERARCHICAL_PRESET.name).toBe("hierarchical");
    });

    it("disables physics", () => {
      expect(HIERARCHICAL_PRESET.config.physics?.enabled).toBe(false);
    });

    it("sets layout algorithm to hierarchical", () => {
      expect(HIERARCHICAL_PRESET.config.layout?.defaultAlgorithm).toBe("hierarchical");
    });

    it("sets direction to top-bottom", () => {
      expect(HIERARCHICAL_PRESET.config.layout?.hierarchical?.direction).toBe("TB");
    });

    it("configures level and node separation", () => {
      expect(HIERARCHICAL_PRESET.config.layout?.hierarchical?.levelSeparation).toBe(120);
      expect(HIERARCHICAL_PRESET.config.layout?.hierarchical?.nodeSeparation).toBe(60);
    });

    it("enables arrows on edges", () => {
      expect(HIERARCHICAL_PRESET.config.rendering?.edges?.showArrows).toBe(true);
    });
  });

  describe("ACCESSIBILITY_PRESET", () => {
    it("has correct name", () => {
      expect(ACCESSIBILITY_PRESET.name).toBe("accessibility");
    });

    it("uses larger node radius", () => {
      expect(ACCESSIBILITY_PRESET.config.rendering?.nodes?.defaultRadius).toBe(12);
    });

    it("uses thicker borders", () => {
      expect(ACCESSIBILITY_PRESET.config.rendering?.nodes?.borderWidth).toBe(3);
    });

    it("uses larger font size", () => {
      expect(ACCESSIBILITY_PRESET.config.rendering?.labels?.fontSize).toBe(16);
    });

    it("uses bold font weight", () => {
      expect(ACCESSIBILITY_PRESET.config.rendering?.labels?.fontWeight).toBe("bold");
    });

    it("uses higher contrast background", () => {
      expect(ACCESSIBILITY_PRESET.config.rendering?.background?.color).toBe("#000000");
    });

    it("uses wider edges", () => {
      expect(ACCESSIBILITY_PRESET.config.rendering?.edges?.defaultWidth).toBe(2);
    });

    it("uses full edge opacity", () => {
      expect(ACCESSIBILITY_PRESET.config.rendering?.edges?.opacity).toBe(1);
    });

    it("enables larger minimap", () => {
      expect(ACCESSIBILITY_PRESET.config.minimap?.enabled).toBe(true);
      expect(ACCESSIBILITY_PRESET.config.minimap?.width).toBe(200);
      expect(ACCESSIBILITY_PRESET.config.minimap?.height).toBe(150);
    });

    it("reduces hover delay", () => {
      expect(ACCESSIBILITY_PRESET.config.interaction?.click?.hoverDelay).toBe(200);
    });
  });

  describe("RADIAL_PRESET", () => {
    it("has correct name", () => {
      expect(RADIAL_PRESET.name).toBe("radial");
    });

    it("enables radial force", () => {
      expect(RADIAL_PRESET.config.physics?.radial?.enabled).toBe(true);
    });

    it("sets layout algorithm to radial", () => {
      expect(RADIAL_PRESET.config.layout?.defaultAlgorithm).toBe("radial");
    });

    it("configures radial layout rings", () => {
      expect(RADIAL_PRESET.config.layout?.radial?.rings).toBe(5);
      expect(RADIAL_PRESET.config.layout?.radial?.ringSeparation).toBe(100);
    });

    it("reduces charge strength", () => {
      expect(RADIAL_PRESET.config.physics?.charge?.strength).toBe(-100);
    });
  });

  describe("COMPACT_PRESET", () => {
    it("has correct name", () => {
      expect(COMPACT_PRESET.name).toBe("compact");
    });

    it("uses smaller node radius", () => {
      expect(COMPACT_PRESET.config.rendering?.nodes?.defaultRadius).toBe(4);
    });

    it("uses thinner edges", () => {
      expect(COMPACT_PRESET.config.rendering?.edges?.defaultWidth).toBe(0.5);
    });

    it("reduces charge strength for tighter packing", () => {
      expect(COMPACT_PRESET.config.physics?.charge?.strength).toBe(-100);
    });

    it("reduces link distance", () => {
      expect(COMPACT_PRESET.config.physics?.link?.distance).toBe(40);
    });

    it("disables minimap", () => {
      expect(COMPACT_PRESET.config.minimap?.enabled).toBe(false);
    });
  });
});

describe("getBuiltInPreset", () => {
  it("returns preset by name", () => {
    const preset = getBuiltInPreset("performance");
    expect(preset).toBe(PERFORMANCE_PRESET);
  });

  it("returns undefined for unknown name", () => {
    const preset = getBuiltInPreset("nonexistent");
    expect(preset).toBeUndefined();
  });

  it("returns correct preset for each built-in", () => {
    expect(getBuiltInPreset("performance")).toBe(PERFORMANCE_PRESET);
    expect(getBuiltInPreset("quality")).toBe(QUALITY_PRESET);
    expect(getBuiltInPreset("dense")).toBe(DENSE_PRESET);
    expect(getBuiltInPreset("hierarchical")).toBe(HIERARCHICAL_PRESET);
    expect(getBuiltInPreset("accessibility")).toBe(ACCESSIBILITY_PRESET);
    expect(getBuiltInPreset("radial")).toBe(RADIAL_PRESET);
    expect(getBuiltInPreset("compact")).toBe(COMPACT_PRESET);
  });
});

describe("isBuiltInPreset", () => {
  it("returns true for built-in preset names", () => {
    expect(isBuiltInPreset("performance")).toBe(true);
    expect(isBuiltInPreset("quality")).toBe(true);
    expect(isBuiltInPreset("dense")).toBe(true);
    expect(isBuiltInPreset("hierarchical")).toBe(true);
    expect(isBuiltInPreset("accessibility")).toBe(true);
    expect(isBuiltInPreset("radial")).toBe(true);
    expect(isBuiltInPreset("compact")).toBe(true);
  });

  it("returns false for custom preset names", () => {
    expect(isBuiltInPreset("my-custom-preset")).toBe(false);
    expect(isBuiltInPreset("user-settings")).toBe(false);
    expect(isBuiltInPreset("")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(isBuiltInPreset("Performance")).toBe(false);
    expect(isBuiltInPreset("QUALITY")).toBe(false);
  });
});

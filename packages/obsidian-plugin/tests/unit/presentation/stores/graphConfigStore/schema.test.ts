/**
 * Unit tests for GraphConfig schema validation
 */

import {
  validateConfig,
  validatePartialConfig,
  validatePreset,
  getDefaultConfig,
  GraphConfigSchema,
  PhysicsConfigSchema,
  RenderingConfigSchema,
  InteractionConfigSchema,
} from "../../../../../src/presentation/stores/graphConfigStore/schema";

describe("GraphConfig Schema Validation", () => {
  describe("getDefaultConfig", () => {
    it("returns valid config that passes validation", () => {
      const config = getDefaultConfig();
      const result = validateConfig(config);

      expect(result.success).toBe(true);
    });

    it("returns config with all required fields", () => {
      const config = getDefaultConfig();

      expect(config.physics).toBeDefined();
      expect(config.rendering).toBeDefined();
      expect(config.interaction).toBeDefined();
      expect(config.filters).toBeDefined();
      expect(config.layout).toBeDefined();
      expect(config.minimap).toBeDefined();
    });
  });

  describe("validateConfig", () => {
    it("accepts valid complete config", () => {
      const config = getDefaultConfig();
      const result = validateConfig(config);

      expect(result.success).toBe(true);
    });

    it("rejects config with invalid physics values", () => {
      const config = {
        ...getDefaultConfig(),
        physics: {
          ...getDefaultConfig().physics,
          simulation: {
            alphaMin: 2, // Invalid: max is 1
            alphaDecay: 0.0228,
            alphaTarget: 0,
            velocityDecay: 0.4,
          },
        },
      };

      const result = validateConfig(config);
      expect(result.success).toBe(false);
    });

    it("rejects config with invalid rendering values", () => {
      const config = {
        ...getDefaultConfig(),
        rendering: {
          ...getDefaultConfig().rendering,
          performance: {
            maxFPS: 200, // Invalid: max is 120
            pixelRatio: "auto" as const,
            antialias: true,
          },
        },
      };

      const result = validateConfig(config);
      expect(result.success).toBe(false);
    });

    it("rejects config with invalid zoom values", () => {
      const config = {
        ...getDefaultConfig(),
        interaction: {
          ...getDefaultConfig().interaction,
          zoom: {
            enabled: true,
            min: 5, // Invalid: max is 1
            max: 10,
            step: 1.2,
          },
        },
      };

      const result = validateConfig(config);
      expect(result.success).toBe(false);
    });

    it("rejects config with missing required fields", () => {
      const result = validateConfig({
        physics: getDefaultConfig().physics,
        // Missing other fields
      });

      expect(result.success).toBe(false);
    });
  });

  describe("validatePartialConfig", () => {
    it("accepts empty partial config", () => {
      const result = validatePartialConfig({});
      expect(result.success).toBe(true);
    });

    it("accepts partial physics config", () => {
      const result = validatePartialConfig({
        physics: {
          enabled: false,
        },
      });
      expect(result.success).toBe(true);
    });

    it("accepts deeply nested partial config", () => {
      const result = validatePartialConfig({
        rendering: {
          performance: {
            maxFPS: 30,
          },
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("validatePreset", () => {
    it("accepts valid preset", () => {
      const result = validatePreset({
        name: "my-preset",
        description: "A test preset",
        config: {
          physics: { enabled: false },
        },
      });

      expect(result.success).toBe(true);
    });

    it("rejects preset with empty name", () => {
      const result = validatePreset({
        name: "",
        description: "A test preset",
        config: {},
      });

      expect(result.success).toBe(false);
    });

    it("rejects preset with name too long", () => {
      const result = validatePreset({
        name: "a".repeat(51),
        description: "A test preset",
        config: {},
      });

      expect(result.success).toBe(false);
    });

    it("rejects preset with description too long", () => {
      const result = validatePreset({
        name: "valid-name",
        description: "a".repeat(201),
        config: {},
      });

      expect(result.success).toBe(false);
    });
  });
});

describe("Physics Schema", () => {
  it("validates simulation config", () => {
    const valid = {
      alphaMin: 0.001,
      alphaDecay: 0.0228,
      alphaTarget: 0,
      velocityDecay: 0.4,
    };

    const config = {
      ...getDefaultConfig().physics,
      simulation: valid,
    };

    const result = PhysicsConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("validates charge force config", () => {
    const config = {
      ...getDefaultConfig().physics,
      charge: {
        enabled: true,
        strength: -500,
        distanceMin: 1,
        distanceMax: 1000,
        theta: 0.9,
      },
    };

    const result = PhysicsConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("validates collision radius auto value", () => {
    const config = {
      ...getDefaultConfig().physics,
      collision: {
        enabled: true,
        radius: "auto" as const,
        strength: 0.7,
        iterations: 1,
      },
    };

    const result = PhysicsConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("validates collision radius numeric value", () => {
    const config = {
      ...getDefaultConfig().physics,
      collision: {
        enabled: true,
        radius: 10,
        strength: 0.7,
        iterations: 1,
      },
    };

    const result = PhysicsConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });
});

describe("Rendering Schema", () => {
  it("validates performance config", () => {
    const config = {
      ...getDefaultConfig().rendering,
      performance: {
        maxFPS: 60,
        pixelRatio: "auto" as const,
        antialias: true,
      },
    };

    const result = RenderingConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("validates pixelRatio numeric value", () => {
    const config = {
      ...getDefaultConfig().rendering,
      performance: {
        maxFPS: 60,
        pixelRatio: 2,
        antialias: true,
      },
    };

    const result = RenderingConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("validates label config with font weights", () => {
    for (const fontWeight of ["normal", "bold", "lighter"] as const) {
      const config = {
        ...getDefaultConfig().rendering,
        labels: {
          ...getDefaultConfig().rendering.labels,
          fontWeight,
        },
      };

      const result = RenderingConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    }
  });
});

describe("Interaction Schema", () => {
  it("validates zoom config", () => {
    const config = {
      ...getDefaultConfig().interaction,
      zoom: {
        enabled: true,
        min: 0.1,
        max: 10,
        step: 1.2,
      },
    };

    const result = InteractionConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("validates selection modifier keys", () => {
    for (const modifierKey of ["ctrl", "shift", "meta", "alt"] as const) {
      const config = {
        ...getDefaultConfig().interaction,
        selection: {
          ...getDefaultConfig().interaction.selection,
          modifierKey,
        },
      };

      const result = InteractionConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    }
  });
});

describe("Layout Schema", () => {
  it("validates force layout algorithm", () => {
    const config = {
      ...getDefaultConfig(),
      layout: {
        ...getDefaultConfig().layout,
        defaultAlgorithm: "force" as const,
      },
    };

    const result = validateConfig(config);
    expect(result.success).toBe(true);
  });

  it("validates all layout algorithms", () => {
    for (const algorithm of ["force", "hierarchical", "radial", "grid"] as const) {
      const config = {
        ...getDefaultConfig(),
        layout: {
          ...getDefaultConfig().layout,
          defaultAlgorithm: algorithm,
        },
      };

      const result = validateConfig(config);
      expect(result.success).toBe(true);
    }
  });

  it("validates hierarchy directions", () => {
    for (const direction of ["TB", "BT", "LR", "RL"] as const) {
      const config = {
        ...getDefaultConfig(),
        layout: {
          ...getDefaultConfig().layout,
          hierarchical: {
            ...getDefaultConfig().layout.hierarchical,
            direction,
          },
        },
      };

      const result = validateConfig(config);
      expect(result.success).toBe(true);
    }
  });
});

describe("Minimap Schema", () => {
  it("validates all minimap positions", () => {
    for (const position of [
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ] as const) {
      const config = {
        ...getDefaultConfig(),
        minimap: {
          ...getDefaultConfig().minimap,
          position,
        },
      };

      const result = validateConfig(config);
      expect(result.success).toBe(true);
    }
  });

  it("validates minimap dimensions", () => {
    const config = {
      ...getDefaultConfig(),
      minimap: {
        enabled: true,
        position: "bottom-right" as const,
        width: 200,
        height: 150,
        opacity: 0.9,
      },
    };

    const result = validateConfig(config);
    expect(result.success).toBe(true);
  });
});

/**
 * Tests for LODSystem - Level of Detail system for zoom-based rendering optimization
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import {
  LODSystem,
  LODLevel,
  createLODSystem,
  DEFAULT_LOD_THRESHOLDS,
  DEFAULT_LOD_SETTINGS,
  type LODEvent,
  type LODEventListener,
} from "../../../../../src/presentation/renderers/graph/LODSystem";

describe("LODSystem", () => {
  let lodSystem: LODSystem;

  beforeEach(() => {
    lodSystem = new LODSystem();
  });

  afterEach(() => {
    lodSystem.destroy();
  });

  describe("initialization", () => {
    it("should initialize with default HIGH LOD level", () => {
      expect(lodSystem.getLevel()).toBe(LODLevel.HIGH);
    });

    it("should have default settings for all LOD levels", () => {
      for (const level of [
        LODLevel.MINIMAL,
        LODLevel.LOW,
        LODLevel.MEDIUM,
        LODLevel.HIGH,
        LODLevel.ULTRA,
      ]) {
        const settings = lodSystem.getSettingsForLevel(level);
        expect(settings).toBeDefined();
        expect(settings.level).toBe(level);
      }
    });

    it("should accept custom configuration", () => {
      const customLOD = new LODSystem({
        hysteresisMargin: 0.1,
        nodeCountThreshold: 500,
      });

      expect(customLOD.getLevel()).toBe(LODLevel.HIGH);
      customLOD.destroy();
    });
  });

  describe("zoom-based LOD calculation", () => {
    it("should return MINIMAL at very low zoom", () => {
      // First set zoom to 0 to avoid hysteresis effects (going from HIGH to MINIMAL)
      lodSystem.setZoom(0.0);
      expect(lodSystem.getLevel()).toBe(LODLevel.MINIMAL);

      // Then verify a slightly higher zoom still gives MINIMAL
      lodSystem.setZoom(0.1);
      expect(lodSystem.getLevel()).toBe(LODLevel.MINIMAL);
    });

    it("should return LOW at low zoom", () => {
      // Go down gradually to avoid hysteresis
      lodSystem.setZoom(0.0);
      lodSystem.setZoom(0.2);
      expect(lodSystem.getLevel()).toBe(LODLevel.LOW);
    });

    it("should return MEDIUM at medium zoom", () => {
      lodSystem.setZoom(0.5);
      expect(lodSystem.getLevel()).toBe(LODLevel.MEDIUM);
    });

    it("should return HIGH at normal zoom", () => {
      lodSystem.setZoom(1.0);
      expect(lodSystem.getLevel()).toBe(LODLevel.HIGH);
    });

    it("should return ULTRA at high zoom", () => {
      lodSystem.setZoom(2.5);
      expect(lodSystem.getLevel()).toBe(LODLevel.ULTRA);
    });
  });

  describe("node count adjustment", () => {
    it("should reduce LOD when node count exceeds threshold", () => {
      lodSystem.setZoom(1.0); // HIGH level
      expect(lodSystem.getLevel()).toBe(LODLevel.HIGH);

      // Exceeding 3x threshold should reduce to MEDIUM
      lodSystem.setNodeCount(4000);
      expect(lodSystem.getLevel()).toBeLessThanOrEqual(LODLevel.MEDIUM);
    });

    it("should not reduce LOD below MINIMAL", () => {
      lodSystem.setZoom(0.1); // Already MINIMAL
      lodSystem.setNodeCount(50000);
      expect(lodSystem.getLevel()).toBe(LODLevel.MINIMAL);
    });
  });

  describe("settings access", () => {
    it("should return correct node settings", () => {
      lodSystem.setZoom(1.0);
      const nodeSettings = lodSystem.getNodeSettings();

      expect(nodeSettings.showShapes).toBe(true);
      expect(nodeSettings.showBorders).toBe(true);
      expect(nodeSettings.showIcons).toBe(true);
    });

    it("should return correct edge settings", () => {
      lodSystem.setZoom(1.0);
      const edgeSettings = lodSystem.getEdgeSettings();

      expect(edgeSettings.showEdges).toBe(true);
      expect(edgeSettings.showArrows).toBe(true);
      expect(edgeSettings.useCurves).toBe(true);
    });

    it("should return correct label settings", () => {
      lodSystem.setZoom(1.0);
      const labelSettings = lodSystem.getLabelSettings();

      expect(labelSettings.showLabels).toBe(true);
    });
  });

  describe("convenience methods", () => {
    it("should correctly report showIcons", () => {
      lodSystem.setZoom(1.0);
      expect(lodSystem.shouldShowIcons()).toBe(true);

      lodSystem.setZoom(0.2);
      expect(lodSystem.shouldShowIcons()).toBe(false);
    });

    it("should correctly report showLabels", () => {
      lodSystem.setZoom(1.0);
      expect(lodSystem.shouldShowLabels()).toBe(true);

      lodSystem.setZoom(0.1);
      expect(lodSystem.shouldShowLabels()).toBe(false);
    });

    it("should correctly report showArrows", () => {
      lodSystem.setZoom(1.0);
      expect(lodSystem.shouldShowArrows()).toBe(true);

      lodSystem.setZoom(0.1);
      expect(lodSystem.shouldShowArrows()).toBe(false);
    });

    it("should correctly report useCurves", () => {
      lodSystem.setZoom(1.0);
      expect(lodSystem.shouldUseCurves()).toBe(true);

      lodSystem.setZoom(0.2);
      expect(lodSystem.shouldUseCurves()).toBe(false);
    });
  });

  describe("event handling", () => {
    it("should emit levelChange event when LOD changes", () => {
      const events: LODEvent[] = [];
      const listener: LODEventListener = (event) => events.push(event);

      lodSystem.addEventListener(listener);
      // Go to 0 first to avoid hysteresis effects
      lodSystem.setZoom(0.0); // Should trigger change to MINIMAL

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe("levelChange");
      expect(events[0].newLevel).toBe(LODLevel.MINIMAL);
    });

    it("should not emit event when LOD stays the same", () => {
      lodSystem.setZoom(1.0); // Set to HIGH

      const events: LODEvent[] = [];
      const listener: LODEventListener = (event) => events.push(event);

      lodSystem.addEventListener(listener);
      lodSystem.setZoom(1.1); // Still in HIGH range

      expect(events.length).toBe(0);
    });

    it("should support removeEventListener", () => {
      const events: LODEvent[] = [];
      const listener: LODEventListener = (event) => events.push(event);

      lodSystem.addEventListener(listener);
      lodSystem.setZoom(0.1);
      expect(events.length).toBeGreaterThan(0);

      lodSystem.removeEventListener(listener);
      const previousLength = events.length;
      lodSystem.setZoom(3.0);

      expect(events.length).toBe(previousLength);
    });

    it("should return unsubscribe function from addEventListener", () => {
      const events: LODEvent[] = [];
      const listener: LODEventListener = (event) => events.push(event);

      const unsubscribe = lodSystem.addEventListener(listener);
      lodSystem.setZoom(0.1);
      expect(events.length).toBeGreaterThan(0);

      unsubscribe();
      const previousLength = events.length;
      lodSystem.setZoom(3.0);

      expect(events.length).toBe(previousLength);
    });
  });

  describe("forceLevel", () => {
    it("should force a specific LOD level", () => {
      lodSystem.setZoom(1.0); // HIGH level normally
      expect(lodSystem.getLevel()).toBe(LODLevel.HIGH);

      lodSystem.forceLevel(LODLevel.MINIMAL);
      expect(lodSystem.getLevel()).toBe(LODLevel.MINIMAL);
    });

    it("should emit event when forcing level", () => {
      const events: LODEvent[] = [];
      lodSystem.addEventListener((event) => events.push(event));

      lodSystem.forceLevel(LODLevel.LOW);

      expect(events.length).toBeGreaterThan(0);
      expect(events[events.length - 1].newLevel).toBe(LODLevel.LOW);
    });
  });

  describe("frame time tracking", () => {
    it("should record frame times", () => {
      lodSystem.recordFrameTime(16.67);
      lodSystem.recordFrameTime(16.67);
      lodSystem.recordFrameTime(16.67);

      const stats = lodSystem.getStats();
      expect(stats.averageFrameTime).toBeCloseTo(16.67, 1);
    });

    it("should reset frame times", () => {
      lodSystem.recordFrameTime(16.67);
      lodSystem.resetFrameTimes();

      const stats = lodSystem.getStats();
      expect(stats.averageFrameTime).toBe(0);
    });
  });

  describe("statistics", () => {
    it("should track level changes", () => {
      lodSystem.setZoom(0.1);
      lodSystem.setZoom(3.0);
      lodSystem.setZoom(0.1);

      const stats = lodSystem.getStats();
      expect(stats.levelChanges).toBeGreaterThanOrEqual(2);
    });

    it("should report current state", () => {
      lodSystem.setZoom(1.0);
      lodSystem.setNodeCount(100);

      const stats = lodSystem.getStats();
      expect(stats.currentLevel).toBe(LODLevel.HIGH);
      expect(stats.currentZoom).toBe(1.0);
      expect(stats.nodeCount).toBe(100);
    });
  });

  describe("updateSettings", () => {
    it("should update settings for a level", () => {
      lodSystem.updateSettings(LODLevel.HIGH, {
        nodes: { showIcons: false, showShapes: true, showBorders: true, showShadows: false, radiusMultiplier: 1.0, maxNodes: -1 },
      });

      lodSystem.setZoom(1.0);
      expect(lodSystem.shouldShowIcons()).toBe(false);
    });

    it("should emit settingsChange event when updating current level", () => {
      lodSystem.setZoom(1.0); // HIGH level

      const events: LODEvent[] = [];
      lodSystem.addEventListener((event) => events.push(event));

      lodSystem.updateSettings(LODLevel.HIGH, {
        labels: { showLabels: false, maxLabelLength: 0, fontSizeMultiplier: 0, maxLabels: 0, useOutline: false },
      });

      expect(events.some((e) => e.type === "settingsChange")).toBe(true);
    });
  });

  describe("getLevelName", () => {
    it("should return correct level names", () => {
      expect(LODSystem.getLevelName(LODLevel.MINIMAL)).toBe("Minimal");
      expect(LODSystem.getLevelName(LODLevel.LOW)).toBe("Low");
      expect(LODSystem.getLevelName(LODLevel.MEDIUM)).toBe("Medium");
      expect(LODSystem.getLevelName(LODLevel.HIGH)).toBe("High");
      expect(LODSystem.getLevelName(LODLevel.ULTRA)).toBe("Ultra");
    });

    it("should return Unknown for invalid levels", () => {
      expect(LODSystem.getLevelName(99 as LODLevel)).toBe("Unknown");
    });
  });

  describe("createLODSystem", () => {
    it("should create LOD system with factory function", () => {
      const lod = createLODSystem();
      expect(lod).toBeInstanceOf(LODSystem);
      lod.destroy();
    });

    it("should pass config to factory function", () => {
      const lod = createLODSystem({
        nodeCountThreshold: 500,
      });

      expect(lod).toBeInstanceOf(LODSystem);
      lod.destroy();
    });
  });

  describe("max element limits", () => {
    it("should return max nodes limit", () => {
      lodSystem.setZoom(1.0);
      const maxNodes = lodSystem.getMaxNodes();
      expect(typeof maxNodes).toBe("number");
    });

    it("should return max edges limit", () => {
      lodSystem.setZoom(1.0);
      const maxEdges = lodSystem.getMaxEdges();
      expect(typeof maxEdges).toBe("number");
    });

    it("should return max labels limit", () => {
      lodSystem.setZoom(1.0);
      const maxLabels = lodSystem.getMaxLabels();
      expect(typeof maxLabels).toBe("number");
    });

    it("should return unlimited (-1) at ULTRA LOD", () => {
      lodSystem.setZoom(3.0); // ULTRA
      expect(lodSystem.getMaxNodes()).toBe(-1);
      expect(lodSystem.getMaxEdges()).toBe(-1);
      expect(lodSystem.getMaxLabels()).toBe(-1);
    });
  });
});

describe("DEFAULT_LOD_THRESHOLDS", () => {
  it("should cover full zoom range", () => {
    expect(DEFAULT_LOD_THRESHOLDS[0].minZoom).toBe(0);
    expect(DEFAULT_LOD_THRESHOLDS[DEFAULT_LOD_THRESHOLDS.length - 1].maxZoom).toBe(Infinity);
  });

  it("should have no gaps in zoom ranges", () => {
    for (let i = 0; i < DEFAULT_LOD_THRESHOLDS.length - 1; i++) {
      const current = DEFAULT_LOD_THRESHOLDS[i];
      const next = DEFAULT_LOD_THRESHOLDS[i + 1];
      expect(current.maxZoom).toBe(next.minZoom);
    }
  });
});

describe("DEFAULT_LOD_SETTINGS", () => {
  it("should have settings for all LOD levels", () => {
    expect(DEFAULT_LOD_SETTINGS.size).toBe(5);
    expect(DEFAULT_LOD_SETTINGS.has(LODLevel.MINIMAL)).toBe(true);
    expect(DEFAULT_LOD_SETTINGS.has(LODLevel.LOW)).toBe(true);
    expect(DEFAULT_LOD_SETTINGS.has(LODLevel.MEDIUM)).toBe(true);
    expect(DEFAULT_LOD_SETTINGS.has(LODLevel.HIGH)).toBe(true);
    expect(DEFAULT_LOD_SETTINGS.has(LODLevel.ULTRA)).toBe(true);
  });

  it("should have progressively more features at higher LOD", () => {
    const minimal = DEFAULT_LOD_SETTINGS.get(LODLevel.MINIMAL)!;
    const ultra = DEFAULT_LOD_SETTINGS.get(LODLevel.ULTRA)!;

    // Minimal should have fewer features
    expect(minimal.nodes.showIcons).toBe(false);
    expect(minimal.labels.showLabels).toBe(false);

    // Ultra should have all features
    expect(ultra.nodes.showIcons).toBe(true);
    expect(ultra.labels.showLabels).toBe(true);
    expect(ultra.nodes.showShadows).toBe(true);
  });
});

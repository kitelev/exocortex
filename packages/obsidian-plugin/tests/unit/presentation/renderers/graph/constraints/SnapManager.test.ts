/**
 * SnapManager Tests
 *
 * Tests for the alignment guide and snap-to-position functionality.
 */

import {
  SnapManager,
  createSnapManager,
  DEFAULT_SNAP_CONFIG,
} from "../../../../../../src/presentation/renderers/graph/constraints/SnapManager";
import type { Point } from "../../../../../../src/presentation/renderers/graph/constraints/constraint.types";

// ============================================================
// Test Utilities
// ============================================================

/**
 * Create a map of positions from an array
 */
function createPositions(
  data: Array<{ id: string; x: number; y: number }>
): Map<string, Point> {
  const map = new Map<string, Point>();
  for (const { id, x, y } of data) {
    map.set(id, { x, y });
  }
  return map;
}

// ============================================================
// Tests
// ============================================================

describe("SnapManager", () => {
  describe("construction", () => {
    it("should create with default config", () => {
      const manager = new SnapManager();
      const config = manager.getConfig();

      expect(config.enabled).toBe(DEFAULT_SNAP_CONFIG.enabled);
      expect(config.snapThreshold).toBe(DEFAULT_SNAP_CONFIG.snapThreshold);
      expect(config.snapToNodes).toBe(DEFAULT_SNAP_CONFIG.snapToNodes);
    });

    it("should create with custom config", () => {
      const manager = new SnapManager({
        snapThreshold: 20,
        snapToGrid: true,
        gridSize: 50,
      });
      const config = manager.getConfig();

      expect(config.snapThreshold).toBe(20);
      expect(config.snapToGrid).toBe(true);
      expect(config.gridSize).toBe(50);
    });

    it("should create using factory function", () => {
      const manager = createSnapManager({ snapThreshold: 15 });
      expect(manager.getSnapThreshold()).toBe(15);
    });
  });

  describe("snap to nodes", () => {
    it("should snap to horizontal alignment", () => {
      const manager = new SnapManager({ snapThreshold: 10 });
      const otherNodes = createPositions([
        { id: "node1", x: 100, y: 100 },
      ]);

      // Position near horizontal alignment
      const result = manager.getSnapResult(
        "dragging",
        { x: 50, y: 105 }, // 5 pixels away from y=100
        otherNodes
      );

      expect(result.snapped).toBe(true);
      expect(result.position.y).toBe(100);
      expect(result.horizontalTarget).toEqual({ x: 100, y: 100 });
    });

    it("should snap to vertical alignment", () => {
      const manager = new SnapManager({ snapThreshold: 10 });
      const otherNodes = createPositions([
        { id: "node1", x: 100, y: 100 },
      ]);

      // Position near vertical alignment
      const result = manager.getSnapResult(
        "dragging",
        { x: 105, y: 50 }, // 5 pixels away from x=100
        otherNodes
      );

      expect(result.snapped).toBe(true);
      expect(result.position.x).toBe(100);
      expect(result.verticalTarget).toEqual({ x: 100, y: 100 });
    });

    it("should snap to both axes", () => {
      const manager = new SnapManager({ snapThreshold: 10 });
      const otherNodes = createPositions([
        { id: "node1", x: 100, y: 50 },
        { id: "node2", x: 50, y: 100 },
      ]);

      // Position near both alignments
      const result = manager.getSnapResult(
        "dragging",
        { x: 55, y: 55 },
        otherNodes
      );

      expect(result.snapped).toBe(true);
      expect(result.position.x).toBe(50);
      expect(result.position.y).toBe(50);
    });

    it("should not snap when outside threshold", () => {
      const manager = new SnapManager({ snapThreshold: 5 });
      const otherNodes = createPositions([
        { id: "node1", x: 100, y: 100 },
      ]);

      // Position too far from alignment
      const result = manager.getSnapResult(
        "dragging",
        { x: 50, y: 120 }, // 20 pixels away
        otherNodes
      );

      expect(result.snapped).toBe(false);
      expect(result.position).toEqual({ x: 50, y: 120 });
    });

    it("should snap to closest node when multiple nearby", () => {
      const manager = new SnapManager({ snapThreshold: 10 });
      const otherNodes = createPositions([
        { id: "node1", x: 100, y: 100 },
        { id: "node2", x: 100, y: 105 },
      ]);

      // Position closer to node1
      const result = manager.getSnapResult(
        "dragging",
        { x: 50, y: 102 },
        otherNodes
      );

      expect(result.snapped).toBe(true);
      expect(result.position.y).toBe(100); // Snaps to closest
    });
  });

  describe("snap to grid", () => {
    it("should snap to grid when enabled", () => {
      const manager = new SnapManager({
        snapToNodes: false,
        snapToGrid: true,
        gridSize: 20,
      });

      const result = manager.getSnapResult(
        "dragging",
        { x: 37, y: 52 },
        new Map()
      );

      expect(result.snapped).toBe(true);
      expect(result.position.x).toBe(40);
      expect(result.position.y).toBe(60);
    });

    it("should use custom grid size", () => {
      const manager = new SnapManager({
        snapToNodes: false,
        snapToGrid: true,
        gridSize: 50,
      });

      const result = manager.getSnapResult(
        "dragging",
        { x: 37, y: 62 },
        new Map()
      );

      expect(result.position.x).toBe(50);
      expect(result.position.y).toBe(50);
    });

    it("should combine node and grid snapping", () => {
      const manager = new SnapManager({
        snapToNodes: true,
        snapToGrid: true,
        gridSize: 20,
        snapThreshold: 10,
      });

      const otherNodes = createPositions([
        { id: "node1", x: 100, y: 100 },
      ]);

      // Node snapping should be applied first, then grid
      const result = manager.getSnapResult(
        "dragging",
        { x: 55, y: 105 },
        otherNodes
      );

      expect(result.snapped).toBe(true);
      // Grid snap on x (55 -> 60), node snap on y (105 -> 100)
      expect(result.position.x).toBe(60);
      expect(result.position.y).toBe(100);
    });
  });

  describe("custom snap positions", () => {
    it("should snap to custom positions", () => {
      const manager = new SnapManager({
        snapToNodes: false,
        snapToGrid: false,
        snapThreshold: 10,
      });

      manager.addCustomSnapPosition({ x: 100, y: 100 });
      manager.addCustomSnapPosition({ x: 200, y: 200 });

      const result = manager.getSnapResult(
        "dragging",
        { x: 105, y: 105 },
        new Map()
      );

      expect(result.snapped).toBe(true);
      expect(result.position).toEqual({ x: 100, y: 100 });
    });

    it("should remove custom snap positions", () => {
      const manager = new SnapManager({ snapThreshold: 10 });

      manager.addCustomSnapPosition({ x: 100, y: 100 });
      const removed = manager.removeCustomSnapPosition({ x: 100, y: 100 });

      expect(removed).toBe(true);

      const result = manager.getSnapResult(
        "dragging",
        { x: 105, y: 105 },
        new Map()
      );

      expect(result.snapped).toBe(false);
    });

    it("should clear all custom snap positions", () => {
      const manager = new SnapManager();

      manager.addCustomSnapPosition({ x: 100, y: 100 });
      manager.addCustomSnapPosition({ x: 200, y: 200 });

      manager.clearCustomSnapPositions();

      const config = manager.getConfig();
      expect(config.customSnapPositions).toHaveLength(0);
    });
  });

  describe("alignment guides", () => {
    it("should create horizontal guide on horizontal snap", () => {
      const manager = new SnapManager({ snapThreshold: 10, showGuides: true });
      const otherNodes = createPositions([
        { id: "node1", x: 100, y: 100 },
      ]);

      manager.getSnapResult("dragging", { x: 50, y: 105 }, otherNodes);

      const guides = manager.getActiveGuides();
      expect(guides).toHaveLength(1);
      expect(guides[0].axis).toBe("horizontal");
      expect(guides[0].position).toBe(100);
    });

    it("should create vertical guide on vertical snap", () => {
      const manager = new SnapManager({ snapThreshold: 10, showGuides: true });
      const otherNodes = createPositions([
        { id: "node1", x: 100, y: 100 },
      ]);

      manager.getSnapResult("dragging", { x: 105, y: 50 }, otherNodes);

      const guides = manager.getActiveGuides();
      expect(guides).toHaveLength(1);
      expect(guides[0].axis).toBe("vertical");
      expect(guides[0].position).toBe(100);
    });

    it("should create both guides when snapping to both axes", () => {
      const manager = new SnapManager({ snapThreshold: 10, showGuides: true });
      const otherNodes = createPositions([
        { id: "node1", x: 100, y: 50 },
        { id: "node2", x: 50, y: 100 },
      ]);

      manager.getSnapResult("dragging", { x: 55, y: 55 }, otherNodes);

      const guides = manager.getActiveGuides();
      expect(guides).toHaveLength(2);
    });

    it("should not create guides when showGuides is false", () => {
      const manager = new SnapManager({ snapThreshold: 10, showGuides: false });
      const otherNodes = createPositions([
        { id: "node1", x: 100, y: 100 },
      ]);

      manager.getSnapResult("dragging", { x: 105, y: 105 }, otherNodes);

      const guides = manager.getActiveGuides();
      expect(guides).toHaveLength(0);
    });

    it("should clear guides", () => {
      const manager = new SnapManager({ snapThreshold: 10, showGuides: true });
      const otherNodes = createPositions([
        { id: "node1", x: 100, y: 100 },
      ]);

      manager.getSnapResult("dragging", { x: 105, y: 105 }, otherNodes);
      expect(manager.getActiveGuides().length).toBeGreaterThan(0);

      manager.clearGuides();
      expect(manager.getActiveGuides()).toHaveLength(0);
    });
  });

  describe("disabled snapping", () => {
    it("should not snap when disabled", () => {
      const manager = new SnapManager({ enabled: false });
      const otherNodes = createPositions([
        { id: "node1", x: 100, y: 100 },
      ]);

      const result = manager.getSnapResult(
        "dragging",
        { x: 100, y: 100 },
        otherNodes
      );

      expect(result.snapped).toBe(false);
      expect(result.position).toEqual({ x: 100, y: 100 });
    });

    it("should enable/disable snapping at runtime", () => {
      const manager = new SnapManager({ snapThreshold: 10 });
      const otherNodes = createPositions([
        { id: "node1", x: 100, y: 100 },
      ]);

      expect(manager.isEnabled()).toBe(true);

      manager.setEnabled(false);
      expect(manager.isEnabled()).toBe(false);

      const result = manager.getSnapResult(
        "dragging",
        { x: 105, y: 105 },
        otherNodes
      );
      expect(result.snapped).toBe(false);

      manager.setEnabled(true);
      expect(manager.isEnabled()).toBe(true);
    });
  });

  describe("configuration", () => {
    it("should update snap threshold", () => {
      const manager = new SnapManager();

      manager.setSnapThreshold(25);
      expect(manager.getSnapThreshold()).toBe(25);
    });

    it("should clamp snap threshold to minimum of 1", () => {
      const manager = new SnapManager();

      manager.setSnapThreshold(-5);
      expect(manager.getSnapThreshold()).toBe(1);
    });

    it("should update grid size", () => {
      const manager = new SnapManager();

      manager.setGridSize(30);
      expect(manager.getGridSize()).toBe(30);
    });

    it("should update snap to nodes setting", () => {
      const manager = new SnapManager({ snapToNodes: true });

      manager.setSnapToNodes(false);
      expect(manager.getConfig().snapToNodes).toBe(false);
    });

    it("should update snap to grid setting", () => {
      const manager = new SnapManager({ snapToGrid: false });

      manager.setSnapToGrid(true);
      expect(manager.getConfig().snapToGrid).toBe(true);
    });

    it("should update show guides setting", () => {
      const manager = new SnapManager({ showGuides: true });

      manager.setShowGuides(false);
      expect(manager.getConfig().showGuides).toBe(false);
    });

    it("should update guide style", () => {
      const manager = new SnapManager();

      manager.setGuideStyle("#00ff00", 0.8, 2);

      const config = manager.getConfig();
      expect(config.guideColor).toBe("#00ff00");
      expect(config.guideOpacity).toBe(0.8);
      expect(config.guideWidth).toBe(2);
    });

    it("should update full config", () => {
      const manager = new SnapManager();

      manager.setConfig({
        enabled: false,
        snapThreshold: 20,
        gridSize: 40,
      });

      const config = manager.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.snapThreshold).toBe(20);
      expect(config.gridSize).toBe(40);
    });
  });
});

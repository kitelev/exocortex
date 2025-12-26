/**
 * Scene3DManager Unit Tests
 *
 * Tests for the 3D scene management and rendering.
 * Since Three.js requires WebGL context (not available in JSDOM),
 * we test the parts that don't require full initialization.
 */

import type { GraphNode3D } from "@plugin/presentation/renderers/graph/3d/types3d";
import {
  Scene3DManager,
  createScene3DManager,
} from "@plugin/presentation/renderers/graph/3d/Scene3DManager";

// Note: Full integration testing of Scene3DManager should be done
// with Playwright component tests or E2E tests where WebGL is available.
// These unit tests focus on the logic that can be tested without WebGL.

describe("Scene3DManager", () => {
  describe("module exports", () => {
    it("exports Scene3DManager class", () => {
      expect(Scene3DManager).toBeDefined();
      expect(typeof Scene3DManager).toBe("function");
    });

    it("exports createScene3DManager factory function", () => {
      expect(createScene3DManager).toBeDefined();
      expect(typeof createScene3DManager).toBe("function");
    });
  });

  describe("constructor (without initialization)", () => {
    it("creates instance with default options", () => {
      const manager = new Scene3DManager();
      expect(manager).toBeDefined();
      expect(manager.isInitialized()).toBe(false);
    });

    it("creates instance with custom options", () => {
      const manager = new Scene3DManager(
        { backgroundColor: 0x000000, cameraFov: 75 },
        { radius: 10, color: 0xff0000 },
        { lineWidth: 2, color: 0x00ff00 },
        { fontSize: 16 },
        { rotateSpeed: 2.0 }
      );

      expect(manager).toBeDefined();
      expect(manager.isInitialized()).toBe(false);
    });

    it("creates instance via factory function", () => {
      const manager = createScene3DManager();
      expect(manager).toBeDefined();
      expect(manager.isInitialized()).toBe(false);
    });
  });

  describe("pre-initialization state", () => {
    it("returns zero size before initialization", () => {
      const manager = new Scene3DManager();
      expect(manager.getSize()).toEqual({ width: 0, height: 0 });
    });

    it("returns default viewport before initialization", () => {
      const manager = new Scene3DManager();
      const viewport = manager.getViewport();

      expect(viewport.cameraPosition).toEqual({ x: 0, y: 0, z: 500 });
      expect(viewport.cameraTarget).toEqual({ x: 0, y: 0, z: 0 });
      expect(viewport.zoom).toBe(1);
    });

    it("returns zero stats before initialization", () => {
      const manager = new Scene3DManager();
      const stats = manager.getStats();

      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
      expect(stats.labelCount).toBe(0);
    });

    it("is safe to destroy without initialization", () => {
      const manager = new Scene3DManager();
      expect(() => manager.destroy()).not.toThrow();
    });
  });

  describe("event listeners (without initialization)", () => {
    it("can add and remove event listeners", () => {
      const manager = new Scene3DManager();
      const listener = jest.fn();

      // Should not throw
      expect(() => manager.on("nodeClick", listener)).not.toThrow();
      expect(() => manager.off("nodeClick", listener)).not.toThrow();
    });

    it("supports all event types", () => {
      const manager = new Scene3DManager();
      const listener = jest.fn();

      const eventTypes = [
        "nodeClick",
        "nodeHover",
        "nodeHoverEnd",
        "edgeClick",
        "edgeHover",
        "edgeHoverEnd",
        "backgroundClick",
        "cameraChange",
        "render",
      ] as const;

      for (const eventType of eventTypes) {
        expect(() => manager.on(eventType, listener)).not.toThrow();
        expect(() => manager.off(eventType, listener)).not.toThrow();
      }
    });
  });

  describe("fitToView", () => {
    it("handles empty nodes array", () => {
      const manager = new Scene3DManager();
      const initialViewport = manager.getViewport();

      manager.fitToView([]);

      expect(manager.getViewport()).toEqual(initialViewport);
    });

    it("handles nodes without positions", () => {
      const manager = new Scene3DManager();

      const nodes: GraphNode3D[] = [
        { id: "n1", label: "Node 1", path: "/n1" },
        { id: "n2", label: "Node 2", path: "/n2" },
      ];

      // Should not throw
      expect(() => manager.fitToView(nodes)).not.toThrow();
    });
  });

  describe("label visibility", () => {
    it("can toggle label visibility without initialization", () => {
      const manager = new Scene3DManager();

      // Should not throw
      expect(() => manager.setLabelsVisible(true)).not.toThrow();
      expect(() => manager.setLabelsVisible(false)).not.toThrow();
    });
  });

  describe("camera position", () => {
    it("can set camera position without initialization", () => {
      const manager = new Scene3DManager();

      // Should not throw
      expect(() => manager.setCameraPosition({ x: 100, y: 200, z: 300 })).not.toThrow();
      expect(() =>
        manager.setCameraPosition({ x: 100, y: 200, z: 300 }, { x: 0, y: 0, z: 0 })
      ).not.toThrow();
    });
  });

  describe("findNodeAtPosition", () => {
    it("returns undefined before initialization", () => {
      const manager = new Scene3DManager();
      const node = manager.findNodeAtPosition(100, 100);

      expect(node).toBeUndefined();
    });
  });

  describe("node and edge management", () => {
    it("can call setNodes without initialization", () => {
      const manager = new Scene3DManager();
      const nodes: GraphNode3D[] = [
        { id: "n1", label: "Node 1", path: "/n1", x: 0, y: 0, z: 0 },
      ];

      // Should not throw (no-op before initialization)
      expect(() => manager.setNodes(nodes)).not.toThrow();
    });

    it("can call setEdges without initialization", () => {
      const manager = new Scene3DManager();
      const nodes: GraphNode3D[] = [
        { id: "n1", label: "Node 1", path: "/n1", x: 0, y: 0, z: 0 },
        { id: "n2", label: "Node 2", path: "/n2", x: 100, y: 0, z: 0 },
      ];
      const edges = [{ id: "e1", source: "n1", target: "n2" }];

      // Should not throw (no-op before initialization)
      expect(() => manager.setEdges(edges, nodes)).not.toThrow();
    });

    it("can call updatePositions without initialization", () => {
      const manager = new Scene3DManager();
      const nodes: GraphNode3D[] = [
        { id: "n1", label: "Node 1", path: "/n1", x: 50, y: 50, z: 50 },
      ];

      // Should not throw (no-op before initialization)
      expect(() => manager.updatePositions(nodes)).not.toThrow();
    });

    it("can call clear without initialization", () => {
      const manager = new Scene3DManager();

      // Should not throw (no-op before initialization)
      expect(() => manager.clear()).not.toThrow();
    });
  });
});

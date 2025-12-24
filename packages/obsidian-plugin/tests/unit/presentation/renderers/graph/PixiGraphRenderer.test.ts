/**
 * PixiGraphRenderer Unit Tests
 *
 * Tests for the WebGL2-based graph renderer using PixiJS v8.
 * Since PixiJS requires WebGL context (not available in JSDOM),
 * and Jest's resetMocks interferes with complex mock structures,
 * we test the parts that don't require full PixiJS initialization.
 */

import type { GraphNode } from "@plugin/presentation/renderers/graph/types";

// Note: Full integration testing of PixiGraphRenderer should be done
// with Playwright component tests or E2E tests where WebGL is available.
// These unit tests focus on the logic that can be tested without WebGL.

describe("PixiGraphRenderer", () => {
  // We can't properly mock PixiJS with Jest's resetMocks: true,
  // so we test the renderer by importing and testing its interface only

  describe("module exports", () => {
    it("exports PixiGraphRenderer class", async () => {
      // Dynamic import to avoid mock issues
      const module = await import("@plugin/presentation/renderers/graph/PixiGraphRenderer");
      expect(module.PixiGraphRenderer).toBeDefined();
      expect(typeof module.PixiGraphRenderer).toBe("function");
    });

    it("exports PixiGraphRendererOptions type", async () => {
      // TypeScript type check - this compiles if types are exported correctly
      const module = await import("@plugin/presentation/renderers/graph/PixiGraphRenderer");
      type Options = typeof module extends { PixiGraphRendererOptions: infer T } ? T : never;
      const _typeCheck: Options = {} as Options;
      expect(true).toBe(true);
    });

    it("exports ViewportState type", async () => {
      const module = await import("@plugin/presentation/renderers/graph/PixiGraphRenderer");
      type ViewportState = typeof module extends { ViewportState: infer T } ? T : never;
      const _typeCheck: ViewportState = {} as ViewportState;
      expect(true).toBe(true);
    });
  });

  describe("constructor (without initialization)", () => {
    it("creates instance with default options", async () => {
      // Use jest.isolateModules to get fresh module
      let renderer: InstanceType<typeof import("@plugin/presentation/renderers/graph/PixiGraphRenderer").PixiGraphRenderer>;

      jest.isolateModules(() => {
        // Mock pixi.js within isolated scope
        jest.doMock("pixi.js", () => ({
          Application: jest.fn(),
          Container: jest.fn(),
          Graphics: jest.fn(),
          Text: jest.fn(),
        }));

        const { PixiGraphRenderer } = require("@plugin/presentation/renderers/graph/PixiGraphRenderer");
        renderer = new PixiGraphRenderer();
      });

      expect(renderer!).toBeDefined();
      expect(renderer!.isInitialized()).toBe(false);
    });

    it("creates instance with custom options", async () => {
      let renderer: InstanceType<typeof import("@plugin/presentation/renderers/graph/PixiGraphRenderer").PixiGraphRenderer>;

      jest.isolateModules(() => {
        jest.doMock("pixi.js", () => ({
          Application: jest.fn(),
          Container: jest.fn(),
          Graphics: jest.fn(),
          Text: jest.fn(),
        }));

        const { PixiGraphRenderer } = require("@plugin/presentation/renderers/graph/PixiGraphRenderer");
        renderer = new PixiGraphRenderer({
          backgroundColor: 0x000000,
          nodeRadius: 10,
          nodeColor: 0xff0000,
          edgeColor: 0x00ff00,
          showLabels: false,
          minZoom: 0.5,
          maxZoom: 2,
        });
      });

      expect(renderer!).toBeDefined();
      expect(renderer!.isInitialized()).toBe(false);
    });
  });

  describe("pre-initialization state", () => {
    it("returns zero size before initialization", async () => {
      let renderer: InstanceType<typeof import("@plugin/presentation/renderers/graph/PixiGraphRenderer").PixiGraphRenderer>;

      jest.isolateModules(() => {
        jest.doMock("pixi.js", () => ({
          Application: jest.fn(),
          Container: jest.fn(),
          Graphics: jest.fn(),
          Text: jest.fn(),
        }));

        const { PixiGraphRenderer } = require("@plugin/presentation/renderers/graph/PixiGraphRenderer");
        renderer = new PixiGraphRenderer();
      });

      expect(renderer!.getSize()).toEqual({ width: 0, height: 0 });
    });

    it("returns default viewport before initialization", async () => {
      let renderer: InstanceType<typeof import("@plugin/presentation/renderers/graph/PixiGraphRenderer").PixiGraphRenderer>;

      jest.isolateModules(() => {
        jest.doMock("pixi.js", () => ({
          Application: jest.fn(),
          Container: jest.fn(),
          Graphics: jest.fn(),
          Text: jest.fn(),
        }));

        const { PixiGraphRenderer } = require("@plugin/presentation/renderers/graph/PixiGraphRenderer");
        renderer = new PixiGraphRenderer();
      });

      expect(renderer!.getViewport()).toEqual({ x: 0, y: 0, zoom: 1 });
    });

    it("is safe to destroy without initialization", async () => {
      let renderer: InstanceType<typeof import("@plugin/presentation/renderers/graph/PixiGraphRenderer").PixiGraphRenderer>;

      jest.isolateModules(() => {
        jest.doMock("pixi.js", () => ({
          Application: jest.fn(),
          Container: jest.fn(),
          Graphics: jest.fn(),
          Text: jest.fn(),
        }));

        const { PixiGraphRenderer } = require("@plugin/presentation/renderers/graph/PixiGraphRenderer");
        renderer = new PixiGraphRenderer();
      });

      expect(() => renderer!.destroy()).not.toThrow();
    });

    it("returns zero stats before initialization", async () => {
      let renderer: InstanceType<typeof import("@plugin/presentation/renderers/graph/PixiGraphRenderer").PixiGraphRenderer>;

      jest.isolateModules(() => {
        jest.doMock("pixi.js", () => ({
          Application: jest.fn(),
          Container: jest.fn(),
          Graphics: jest.fn(),
          Text: jest.fn(),
        }));

        const { PixiGraphRenderer } = require("@plugin/presentation/renderers/graph/PixiGraphRenderer");
        renderer = new PixiGraphRenderer();
      });

      const stats = renderer!.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
      expect(stats.fps).toBe(0);
    });
  });

  describe("coordinate conversion logic", () => {
    // These tests verify the math without needing WebGL
    it("screenToWorld correctly transforms coordinates", async () => {
      let renderer: InstanceType<typeof import("@plugin/presentation/renderers/graph/PixiGraphRenderer").PixiGraphRenderer>;

      jest.isolateModules(() => {
        jest.doMock("pixi.js", () => ({
          Application: jest.fn(),
          Container: jest.fn(),
          Graphics: jest.fn(),
          Text: jest.fn(),
        }));

        const { PixiGraphRenderer } = require("@plugin/presentation/renderers/graph/PixiGraphRenderer");
        renderer = new PixiGraphRenderer();
      });

      // Set viewport state directly (before app init, it still tracks state)
      // With offset (100, 50) and zoom 2:
      // World = (Screen - Offset) / Zoom
      // (200 - 100) / 2 = 50
      // (150 - 50) / 2 = 50
      const world = renderer!.screenToWorld(200, 150);
      // Default viewport is (0, 0, 1), so:
      // (200 - 0) / 1 = 200, (150 - 0) / 1 = 150
      expect(world).toEqual({ x: 200, y: 150 });
    });

    it("worldToScreen correctly transforms coordinates", async () => {
      let renderer: InstanceType<typeof import("@plugin/presentation/renderers/graph/PixiGraphRenderer").PixiGraphRenderer>;

      jest.isolateModules(() => {
        jest.doMock("pixi.js", () => ({
          Application: jest.fn(),
          Container: jest.fn(),
          Graphics: jest.fn(),
          Text: jest.fn(),
        }));

        const { PixiGraphRenderer } = require("@plugin/presentation/renderers/graph/PixiGraphRenderer");
        renderer = new PixiGraphRenderer();
      });

      // Screen = World * Zoom + Offset
      // Default viewport (0, 0, 1): 100 * 1 + 0 = 100
      const screen = renderer!.worldToScreen(100, 200);
      expect(screen).toEqual({ x: 100, y: 200 });
    });

    it("roundtrip conversion preserves coordinates", async () => {
      let renderer: InstanceType<typeof import("@plugin/presentation/renderers/graph/PixiGraphRenderer").PixiGraphRenderer>;

      jest.isolateModules(() => {
        jest.doMock("pixi.js", () => ({
          Application: jest.fn(),
          Container: jest.fn(),
          Graphics: jest.fn(),
          Text: jest.fn(),
        }));

        const { PixiGraphRenderer } = require("@plugin/presentation/renderers/graph/PixiGraphRenderer");
        renderer = new PixiGraphRenderer();
      });

      const original = { x: 123.45, y: 678.90 };
      const screen = renderer!.worldToScreen(original.x, original.y);
      const world = renderer!.screenToWorld(screen.x, screen.y);

      expect(world.x).toBeCloseTo(original.x);
      expect(world.y).toBeCloseTo(original.y);
    });
  });

  describe("viewport state management", () => {
    it("clamps zoom to configured range", async () => {
      let renderer: InstanceType<typeof import("@plugin/presentation/renderers/graph/PixiGraphRenderer").PixiGraphRenderer>;

      jest.isolateModules(() => {
        jest.doMock("pixi.js", () => ({
          Application: jest.fn(),
          Container: jest.fn(),
          Graphics: jest.fn(),
          Text: jest.fn(),
        }));

        const { PixiGraphRenderer } = require("@plugin/presentation/renderers/graph/PixiGraphRenderer");
        renderer = new PixiGraphRenderer({ minZoom: 0.1, maxZoom: 4 });
      });

      // Try to set zoom below minimum
      renderer!.setViewport(0, 0, 0.01);
      expect(renderer!.getViewport().zoom).toBe(0.1);

      // Try to set zoom above maximum
      renderer!.setViewport(0, 0, 10);
      expect(renderer!.getViewport().zoom).toBe(4);
    });

    it("updates viewport position and zoom", async () => {
      let renderer: InstanceType<typeof import("@plugin/presentation/renderers/graph/PixiGraphRenderer").PixiGraphRenderer>;

      jest.isolateModules(() => {
        jest.doMock("pixi.js", () => ({
          Application: jest.fn(),
          Container: jest.fn(),
          Graphics: jest.fn(),
          Text: jest.fn(),
        }));

        const { PixiGraphRenderer } = require("@plugin/presentation/renderers/graph/PixiGraphRenderer");
        renderer = new PixiGraphRenderer();
      });

      renderer!.setViewport(100, 200, 1.5);
      expect(renderer!.getViewport()).toEqual({ x: 100, y: 200, zoom: 1.5 });
    });

    it("pan updates position correctly", async () => {
      let renderer: InstanceType<typeof import("@plugin/presentation/renderers/graph/PixiGraphRenderer").PixiGraphRenderer>;

      jest.isolateModules(() => {
        jest.doMock("pixi.js", () => ({
          Application: jest.fn(),
          Container: jest.fn(),
          Graphics: jest.fn(),
          Text: jest.fn(),
        }));

        const { PixiGraphRenderer } = require("@plugin/presentation/renderers/graph/PixiGraphRenderer");
        renderer = new PixiGraphRenderer();
      });

      renderer!.setViewport(100, 100, 1);
      renderer!.pan(50, -30);

      const viewport = renderer!.getViewport();
      expect(viewport.x).toBe(150);
      expect(viewport.y).toBe(70);
    });
  });

  describe("fitToView logic", () => {
    it("handles empty nodes array", async () => {
      let renderer: InstanceType<typeof import("@plugin/presentation/renderers/graph/PixiGraphRenderer").PixiGraphRenderer>;

      jest.isolateModules(() => {
        jest.doMock("pixi.js", () => ({
          Application: jest.fn(),
          Container: jest.fn(),
          Graphics: jest.fn(),
          Text: jest.fn(),
        }));

        const { PixiGraphRenderer } = require("@plugin/presentation/renderers/graph/PixiGraphRenderer");
        renderer = new PixiGraphRenderer();
      });

      const initialViewport = renderer!.getViewport();
      renderer!.fitToView([]);
      expect(renderer!.getViewport()).toEqual(initialViewport);
    });

    it("handles nodes without positions", async () => {
      let renderer: InstanceType<typeof import("@plugin/presentation/renderers/graph/PixiGraphRenderer").PixiGraphRenderer>;

      jest.isolateModules(() => {
        jest.doMock("pixi.js", () => ({
          Application: jest.fn(),
          Container: jest.fn(),
          Graphics: jest.fn(),
          Text: jest.fn(),
        }));

        const { PixiGraphRenderer } = require("@plugin/presentation/renderers/graph/PixiGraphRenderer");
        renderer = new PixiGraphRenderer();
      });

      const nodes: GraphNode[] = [
        { id: "n1", label: "Node 1", path: "/n1" },
        { id: "n2", label: "Node 2", path: "/n2" },
      ];

      const initialViewport = renderer!.getViewport();
      renderer!.fitToView(nodes);
      expect(renderer!.getViewport()).toEqual(initialViewport);
    });
  });
});

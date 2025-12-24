/**
 * NodeRenderer Unit Tests
 *
 * Tests for:
 * - NodeVisualStyle defaults
 * - Shape drawing functions
 * - NodeStyleResolver type resolution
 * - NodeRenderer node lifecycle (create, update, remove)
 * - Object pooling
 * - Radius calculation
 */

import {
  NodeStyleResolver,
  SHAPE_DRAWERS,
  DEFAULT_NODE_STYLE,
  DEFAULT_NODE_TYPE_CONFIGS,
  calculateNodeRadius,
  type NodeTypeConfig,
  type NodeShape,
} from "@plugin/presentation/renderers/graph/NodeRenderer";

describe("NodeRenderer Module", () => {
  describe("DEFAULT_NODE_STYLE", () => {
    it("should have correct default shape", () => {
      expect(DEFAULT_NODE_STYLE.shape).toBe("circle");
    });

    it("should have correct default radius", () => {
      expect(DEFAULT_NODE_STYLE.radius).toBe(8);
    });

    it("should have default fill color", () => {
      expect(DEFAULT_NODE_STYLE.fillColor).toBe(0x6366f1);
    });

    it("should have default fill alpha", () => {
      expect(DEFAULT_NODE_STYLE.fillAlpha).toBe(1);
    });

    it("should have default border settings", () => {
      expect(DEFAULT_NODE_STYLE.borderWidth).toBe(1);
      expect(DEFAULT_NODE_STYLE.borderColor).toBe(0xffffff);
      expect(DEFAULT_NODE_STYLE.borderAlpha).toBe(0.3);
    });

    it("should have shadow disabled by default", () => {
      expect(DEFAULT_NODE_STYLE.shadowEnabled).toBe(false);
    });

    it("should have hover scale", () => {
      expect(DEFAULT_NODE_STYLE.hoverScale).toBe(1.2);
    });

    it("should have selected border settings", () => {
      expect(DEFAULT_NODE_STYLE.selectedBorderColor).toBe(0xfbbf24);
      expect(DEFAULT_NODE_STYLE.selectedBorderWidth).toBe(2);
    });
  });

  describe("DEFAULT_NODE_TYPE_CONFIGS", () => {
    it("should have configuration for Task", () => {
      const taskConfig = DEFAULT_NODE_TYPE_CONFIGS.find(
        (c) => c.classUri === "ems__Task"
      );
      expect(taskConfig).toBeDefined();
      expect(taskConfig?.style.shape).toBe("roundedRect");
      expect(taskConfig?.style.fillColor).toBe(0x22c55e);
    });

    it("should have configuration for Project", () => {
      const projectConfig = DEFAULT_NODE_TYPE_CONFIGS.find(
        (c) => c.classUri === "ems__Project"
      );
      expect(projectConfig).toBeDefined();
      expect(projectConfig?.style.shape).toBe("hexagon");
      expect(projectConfig?.style.fillColor).toBe(0x3b82f6);
    });

    it("should have configuration for Area", () => {
      const areaConfig = DEFAULT_NODE_TYPE_CONFIGS.find(
        (c) => c.classUri === "ems__Area"
      );
      expect(areaConfig).toBeDefined();
      expect(areaConfig?.style.shape).toBe("circle");
      expect(areaConfig?.style.fillColor).toBe(0xa855f7);
    });

    it("should have configuration for Person", () => {
      const personConfig = DEFAULT_NODE_TYPE_CONFIGS.find(
        (c) => c.classUri === "ems__Person"
      );
      expect(personConfig).toBeDefined();
      expect(personConfig?.style.shape).toBe("circle");
      expect(personConfig?.style.fillColor).toBe(0xf97316);
    });

    it("should have configuration for Concept", () => {
      const conceptConfig = DEFAULT_NODE_TYPE_CONFIGS.find(
        (c) => c.classUri === "ims__Concept"
      );
      expect(conceptConfig).toBeDefined();
      expect(conceptConfig?.style.shape).toBe("diamond");
      expect(conceptConfig?.style.fillColor).toBe(0x6b7280);
    });
  });

  describe("SHAPE_DRAWERS", () => {
    // Create mock graphics for testing shape drawers
    const createMockGraphics = () => ({
      circle: jest.fn().mockReturnThis(),
      rect: jest.fn().mockReturnThis(),
      roundRect: jest.fn().mockReturnThis(),
      moveTo: jest.fn().mockReturnThis(),
      lineTo: jest.fn().mockReturnThis(),
      closePath: jest.fn().mockReturnThis(),
      fill: jest.fn().mockReturnThis(),
      stroke: jest.fn().mockReturnThis(),
      clear: jest.fn().mockReturnThis(),
    });

    it("should have drawer for circle", () => {
      expect(SHAPE_DRAWERS.circle).toBeDefined();
      const mockGraphics = createMockGraphics();
      SHAPE_DRAWERS.circle(mockGraphics as any, 10);
      expect(mockGraphics.circle).toHaveBeenCalledWith(0, 0, 10);
    });

    it("should have drawer for rect", () => {
      expect(SHAPE_DRAWERS.rect).toBeDefined();
      const mockGraphics = createMockGraphics();
      SHAPE_DRAWERS.rect(mockGraphics as any, 10);
      const size = 10 * 1.6;
      expect(mockGraphics.rect).toHaveBeenCalledWith(
        -size / 2,
        -size / 2,
        size,
        size
      );
    });

    it("should have drawer for roundedRect", () => {
      expect(SHAPE_DRAWERS.roundedRect).toBeDefined();
      const mockGraphics = createMockGraphics();
      SHAPE_DRAWERS.roundedRect(mockGraphics as any, 10);
      expect(mockGraphics.roundRect).toHaveBeenCalled();
    });

    it("should have drawer for diamond", () => {
      expect(SHAPE_DRAWERS.diamond).toBeDefined();
      const mockGraphics = createMockGraphics();
      SHAPE_DRAWERS.diamond(mockGraphics as any, 10);
      expect(mockGraphics.moveTo).toHaveBeenCalled();
      expect(mockGraphics.lineTo).toHaveBeenCalledTimes(3);
      expect(mockGraphics.closePath).toHaveBeenCalled();
    });

    it("should have drawer for hexagon", () => {
      expect(SHAPE_DRAWERS.hexagon).toBeDefined();
      const mockGraphics = createMockGraphics();
      SHAPE_DRAWERS.hexagon(mockGraphics as any, 10);
      expect(mockGraphics.moveTo).toHaveBeenCalled();
      expect(mockGraphics.lineTo).toHaveBeenCalledTimes(5);
      expect(mockGraphics.closePath).toHaveBeenCalled();
    });

    it("should have drawer for triangle", () => {
      expect(SHAPE_DRAWERS.triangle).toBeDefined();
      const mockGraphics = createMockGraphics();
      SHAPE_DRAWERS.triangle(mockGraphics as any, 10);
      expect(mockGraphics.moveTo).toHaveBeenCalled();
      expect(mockGraphics.lineTo).toHaveBeenCalledTimes(2);
      expect(mockGraphics.closePath).toHaveBeenCalled();
    });

    it("should have all 6 required shapes", () => {
      const shapes: NodeShape[] = [
        "circle",
        "rect",
        "roundedRect",
        "diamond",
        "hexagon",
        "triangle",
      ];
      for (const shape of shapes) {
        expect(SHAPE_DRAWERS[shape]).toBeDefined();
      }
    });
  });

  describe("NodeStyleResolver", () => {
    let resolver: NodeStyleResolver;

    beforeEach(() => {
      resolver = new NodeStyleResolver();
    });

    describe("resolveStyle", () => {
      it("should return default style for undefined class", () => {
        const style = resolver.resolveStyle(undefined);
        expect(style.shape).toBe("circle");
        expect(style.radius).toBe(8);
      });

      it("should return default style for unknown class", () => {
        const style = resolver.resolveStyle("unknown__Class");
        expect(style.shape).toBe("circle");
        expect(style.radius).toBe(8);
      });

      it("should resolve Task style", () => {
        const style = resolver.resolveStyle("ems__Task");
        expect(style.shape).toBe("roundedRect");
        expect(style.fillColor).toBe(0x22c55e);
      });

      it("should resolve Project style", () => {
        const style = resolver.resolveStyle("ems__Project");
        expect(style.shape).toBe("hexagon");
        expect(style.fillColor).toBe(0x3b82f6);
      });

      it("should resolve Area style", () => {
        const style = resolver.resolveStyle("ems__Area");
        expect(style.shape).toBe("circle");
        expect(style.fillColor).toBe(0xa855f7);
      });

      it("should resolve Person style", () => {
        const style = resolver.resolveStyle("ems__Person");
        expect(style.shape).toBe("circle");
        expect(style.fillColor).toBe(0xf97316);
      });

      it("should resolve Concept style", () => {
        const style = resolver.resolveStyle("ims__Concept");
        expect(style.shape).toBe("diamond");
        expect(style.fillColor).toBe(0x6b7280);
      });

      it("should merge with default style", () => {
        const style = resolver.resolveStyle("ems__Task");
        // Should have Task-specific properties
        expect(style.shape).toBe("roundedRect");
        // Should also have default properties not overridden
        expect(style.radius).toBe(8);
        expect(style.borderWidth).toBe(1);
      });
    });

    describe("registerType", () => {
      it("should register a new type configuration", () => {
        const customConfig: NodeTypeConfig = {
          classUri: "custom__Type",
          displayName: "Custom",
          style: {
            shape: "triangle",
            fillColor: 0xff0000,
          },
        };

        resolver.registerType(customConfig);
        const style = resolver.resolveStyle("custom__Type");

        expect(style.shape).toBe("triangle");
        expect(style.fillColor).toBe(0xff0000);
      });

      it("should override existing type configuration", () => {
        const overrideConfig: NodeTypeConfig = {
          classUri: "ems__Task",
          displayName: "Custom Task",
          style: {
            shape: "diamond",
            fillColor: 0x00ff00,
          },
        };

        resolver.registerType(overrideConfig);
        const style = resolver.resolveStyle("ems__Task");

        expect(style.shape).toBe("diamond");
        expect(style.fillColor).toBe(0x00ff00);
      });
    });

    describe("getTypeConfigs", () => {
      it("should return all type configurations", () => {
        const configs = resolver.getTypeConfigs();
        expect(configs.length).toBe(5); // Default configs
      });

      it("should include newly registered types", () => {
        resolver.registerType({
          classUri: "custom__Type",
          displayName: "Custom",
          style: { shape: "triangle" },
        });

        const configs = resolver.getTypeConfigs();
        expect(configs.length).toBe(6);
      });
    });

    describe("setDefaultStyle", () => {
      it("should update default style", () => {
        resolver.setDefaultStyle({ radius: 16, fillColor: 0xff0000 });
        const defaultStyle = resolver.getDefaultStyle();

        expect(defaultStyle.radius).toBe(16);
        expect(defaultStyle.fillColor).toBe(0xff0000);
        // Other defaults should remain
        expect(defaultStyle.shape).toBe("circle");
      });

      it("should affect unregistered type resolution", () => {
        resolver.setDefaultStyle({ radius: 20 });
        const style = resolver.resolveStyle("unknown__Type");

        expect(style.radius).toBe(20);
      });
    });

    describe("custom type configurations", () => {
      it("should accept custom type configs in constructor", () => {
        const customConfigs: NodeTypeConfig[] = [
          {
            classUri: "custom__Alpha",
            displayName: "Alpha",
            style: { shape: "hexagon", fillColor: 0x111111 },
          },
          {
            classUri: "custom__Beta",
            displayName: "Beta",
            style: { shape: "triangle", fillColor: 0x222222 },
          },
        ];

        const customResolver = new NodeStyleResolver(customConfigs);

        const alphaStyle = customResolver.resolveStyle("custom__Alpha");
        expect(alphaStyle.shape).toBe("hexagon");
        expect(alphaStyle.fillColor).toBe(0x111111);

        const betaStyle = customResolver.resolveStyle("custom__Beta");
        expect(betaStyle.shape).toBe("triangle");
        expect(betaStyle.fillColor).toBe(0x222222);

        // Should not have default configs
        const taskStyle = customResolver.resolveStyle("ems__Task");
        expect(taskStyle.shape).toBe("circle"); // Falls back to default
      });
    });
  });

  describe("NodeRenderer with mocked PixiJS", () => {
    // These tests use jest.isolateModules because Jest's resetMocks: true
    // interferes with complex mock structures for PixiJS

    it("should create a NodeRenderer instance", () => {
      jest.isolateModules(() => {
        jest.doMock("pixi.js", () => ({
          Container: jest.fn().mockImplementation(() => ({
            addChild: jest.fn(),
            removeChild: jest.fn(),
            position: { set: jest.fn() },
            destroy: jest.fn(),
          })),
          Graphics: jest.fn().mockImplementation(() => ({
            clear: jest.fn().mockReturnThis(),
            circle: jest.fn().mockReturnThis(),
            rect: jest.fn().mockReturnThis(),
            roundRect: jest.fn().mockReturnThis(),
            moveTo: jest.fn().mockReturnThis(),
            lineTo: jest.fn().mockReturnThis(),
            closePath: jest.fn().mockReturnThis(),
            fill: jest.fn().mockReturnThis(),
            stroke: jest.fn().mockReturnThis(),
            destroy: jest.fn(),
            removeFromParent: jest.fn(),
            position: { set: jest.fn() },
          })),
          Text: jest.fn().mockImplementation(() => ({
            anchor: { set: jest.fn() },
            destroy: jest.fn(),
          })),
        }));

        const { NodeRenderer } = require("@plugin/presentation/renderers/graph/NodeRenderer");
        const renderer = new NodeRenderer();
        expect(renderer).toBeDefined();
        expect(renderer.getStats().renderedNodeCount).toBe(0);
        renderer.destroy();
      });
    });

    it("should create and manage nodes", () => {
      jest.isolateModules(() => {
        jest.doMock("pixi.js", () => ({
          Container: jest.fn().mockImplementation(() => ({
            addChild: jest.fn(),
            removeChild: jest.fn(),
            position: { set: jest.fn() },
            destroy: jest.fn(),
          })),
          Graphics: jest.fn().mockImplementation(() => ({
            clear: jest.fn().mockReturnThis(),
            circle: jest.fn().mockReturnThis(),
            rect: jest.fn().mockReturnThis(),
            roundRect: jest.fn().mockReturnThis(),
            moveTo: jest.fn().mockReturnThis(),
            lineTo: jest.fn().mockReturnThis(),
            closePath: jest.fn().mockReturnThis(),
            fill: jest.fn().mockReturnThis(),
            stroke: jest.fn().mockReturnThis(),
            destroy: jest.fn(),
            removeFromParent: jest.fn(),
            position: { set: jest.fn() },
          })),
          Text: jest.fn().mockImplementation(() => ({
            anchor: { set: jest.fn() },
            destroy: jest.fn(),
          })),
        }));

        const { NodeRenderer } = require("@plugin/presentation/renderers/graph/NodeRenderer");
        const renderer = new NodeRenderer();

        // Create nodes
        const node1 = renderer.createNode("node-1", "ems__Task");
        const node2 = renderer.createNode("node-2", "ems__Project");

        expect(node1.nodeId).toBe("node-1");
        expect(node1.style.shape).toBe("roundedRect");
        expect(node2.nodeId).toBe("node-2");
        expect(node2.style.shape).toBe("hexagon");
        expect(renderer.getStats().renderedNodeCount).toBe(2);

        // Remove node
        renderer.removeNode("node-1");
        expect(renderer.getNode("node-1")).toBeUndefined();
        expect(renderer.getStats().renderedNodeCount).toBe(1);

        renderer.destroy();
      });
    });

    it("should update node positions and states", () => {
      jest.isolateModules(() => {
        const mockPosition = { set: jest.fn() };
        jest.doMock("pixi.js", () => ({
          Container: jest.fn().mockImplementation(() => ({
            addChild: jest.fn(),
            removeChild: jest.fn(),
            position: mockPosition,
            destroy: jest.fn(),
          })),
          Graphics: jest.fn().mockImplementation(() => ({
            clear: jest.fn().mockReturnThis(),
            circle: jest.fn().mockReturnThis(),
            rect: jest.fn().mockReturnThis(),
            roundRect: jest.fn().mockReturnThis(),
            moveTo: jest.fn().mockReturnThis(),
            lineTo: jest.fn().mockReturnThis(),
            closePath: jest.fn().mockReturnThis(),
            fill: jest.fn().mockReturnThis(),
            stroke: jest.fn().mockReturnThis(),
            destroy: jest.fn(),
            removeFromParent: jest.fn(),
            position: { set: jest.fn() },
          })),
          Text: jest.fn().mockImplementation(() => ({
            anchor: { set: jest.fn() },
            destroy: jest.fn(),
          })),
        }));

        const { NodeRenderer } = require("@plugin/presentation/renderers/graph/NodeRenderer");
        const renderer = new NodeRenderer();

        const node = renderer.createNode("node-1");
        renderer.updateNode("node-1", 100, 200, true, false);

        expect(node.isHovered).toBe(true);
        expect(node.isSelected).toBe(false);
        expect(node.container.position.set).toHaveBeenCalledWith(100, 200);

        renderer.destroy();
      });
    });

    it("should support object pooling", () => {
      jest.isolateModules(() => {
        jest.doMock("pixi.js", () => ({
          Container: jest.fn().mockImplementation(() => ({
            addChild: jest.fn(),
            removeChild: jest.fn(),
            position: { set: jest.fn() },
            destroy: jest.fn(),
          })),
          Graphics: jest.fn().mockImplementation(() => ({
            clear: jest.fn().mockReturnThis(),
            circle: jest.fn().mockReturnThis(),
            rect: jest.fn().mockReturnThis(),
            roundRect: jest.fn().mockReturnThis(),
            moveTo: jest.fn().mockReturnThis(),
            lineTo: jest.fn().mockReturnThis(),
            closePath: jest.fn().mockReturnThis(),
            fill: jest.fn().mockReturnThis(),
            stroke: jest.fn().mockReturnThis(),
            destroy: jest.fn(),
            removeFromParent: jest.fn(),
            position: { set: jest.fn() },
          })),
          Text: jest.fn().mockImplementation(() => ({
            anchor: { set: jest.fn() },
            destroy: jest.fn(),
          })),
        }));

        const { NodeRenderer } = require("@plugin/presentation/renderers/graph/NodeRenderer");
        const renderer = new NodeRenderer();

        // Create and remove nodes to populate pool
        renderer.createNode("node-1");
        renderer.createNode("node-2");
        renderer.removeNode("node-1");
        renderer.removeNode("node-2");

        // Pool should have 2 graphics
        expect(renderer.getStats().poolSize).toBe(2);
        expect(renderer.getStats().renderedNodeCount).toBe(0);

        // Create new node - should reuse from pool
        renderer.createNode("node-3");
        expect(renderer.getStats().poolSize).toBe(1);
        expect(renderer.getStats().renderedNodeCount).toBe(1);

        renderer.destroy();
      });
    });

    it("should clear all nodes", () => {
      jest.isolateModules(() => {
        jest.doMock("pixi.js", () => ({
          Container: jest.fn().mockImplementation(() => ({
            addChild: jest.fn(),
            removeChild: jest.fn(),
            position: { set: jest.fn() },
            destroy: jest.fn(),
          })),
          Graphics: jest.fn().mockImplementation(() => ({
            clear: jest.fn().mockReturnThis(),
            circle: jest.fn().mockReturnThis(),
            rect: jest.fn().mockReturnThis(),
            roundRect: jest.fn().mockReturnThis(),
            moveTo: jest.fn().mockReturnThis(),
            lineTo: jest.fn().mockReturnThis(),
            closePath: jest.fn().mockReturnThis(),
            fill: jest.fn().mockReturnThis(),
            stroke: jest.fn().mockReturnThis(),
            destroy: jest.fn(),
            removeFromParent: jest.fn(),
            position: { set: jest.fn() },
          })),
          Text: jest.fn().mockImplementation(() => ({
            anchor: { set: jest.fn() },
            destroy: jest.fn(),
          })),
        }));

        const { NodeRenderer } = require("@plugin/presentation/renderers/graph/NodeRenderer");
        const renderer = new NodeRenderer();

        renderer.createNode("node-1");
        renderer.createNode("node-2");
        renderer.createNode("node-3");

        expect(renderer.getAllNodes().length).toBe(3);

        renderer.clear();

        expect(renderer.getAllNodes().length).toBe(0);
        expect(renderer.getStats().poolSize).toBe(3);

        renderer.destroy();
      });
    });
  });

  describe("calculateNodeRadius", () => {
    describe("fixed mode", () => {
      it("should return base radius", () => {
        const radius = calculateNodeRadius("fixed", 10);
        expect(radius).toBe(10);
      });

      it("should ignore degree and pagerank", () => {
        const radius = calculateNodeRadius("fixed", 10, 100, 0.9);
        expect(radius).toBe(10);
      });

      it("should respect minimum radius", () => {
        const radius = calculateNodeRadius("fixed", 2, 0, 0, 5, 50);
        expect(radius).toBe(5);
      });

      it("should respect maximum radius", () => {
        const radius = calculateNodeRadius("fixed", 100, 0, 0, 5, 50);
        expect(radius).toBe(50);
      });
    });

    describe("degree mode", () => {
      it("should scale based on degree", () => {
        const lowDegree = calculateNodeRadius("degree", 10, 1);
        const highDegree = calculateNodeRadius("degree", 10, 100);

        expect(highDegree).toBeGreaterThan(lowDegree);
      });

      it("should return base radius for zero degree", () => {
        const radius = calculateNodeRadius("degree", 10, 0);
        expect(radius).toBe(10);
      });

      it("should use logarithmic scaling", () => {
        const degree10 = calculateNodeRadius("degree", 10, 10);
        const degree100 = calculateNodeRadius("degree", 10, 100);
        const degree1000 = calculateNodeRadius("degree", 10, 1000);

        // Logarithmic: difference between 10->100 should be similar to 100->1000
        const diff1 = degree100 - degree10;
        const diff2 = degree1000 - degree100;

        expect(Math.abs(diff1 - diff2)).toBeLessThan(2);
      });
    });

    describe("pagerank mode", () => {
      it("should scale based on pagerank", () => {
        const lowRank = calculateNodeRadius("pagerank", 10, 0, 0.1);
        const highRank = calculateNodeRadius("pagerank", 10, 0, 0.9);

        expect(highRank).toBeGreaterThan(lowRank);
      });

      it("should return base radius for zero pagerank", () => {
        const radius = calculateNodeRadius("pagerank", 10, 0, 0);
        expect(radius).toBe(10);
      });
    });

    describe("clamping", () => {
      it("should clamp to minimum radius", () => {
        const radius = calculateNodeRadius("fixed", 1, 0, 0, 5, 50);
        expect(radius).toBe(5);
      });

      it("should clamp to maximum radius", () => {
        const radius = calculateNodeRadius("pagerank", 10, 0, 10, 5, 50);
        expect(radius).toBe(50);
      });

      it("should use default min/max when not specified", () => {
        const smallRadius = calculateNodeRadius("fixed", 1);
        expect(smallRadius).toBe(4); // Default minRadius

        const largeRadius = calculateNodeRadius("pagerank", 10, 0, 2);
        expect(largeRadius).toBe(32); // Default maxRadius
      });
    });
  });

  describe("integration scenarios", () => {
    it("should support complete node lifecycle", () => {
      jest.isolateModules(() => {
        jest.doMock("pixi.js", () => ({
          Container: jest.fn().mockImplementation(() => ({
            addChild: jest.fn(),
            removeChild: jest.fn(),
            position: { set: jest.fn() },
            destroy: jest.fn(),
          })),
          Graphics: jest.fn().mockImplementation(() => ({
            clear: jest.fn().mockReturnThis(),
            circle: jest.fn().mockReturnThis(),
            rect: jest.fn().mockReturnThis(),
            roundRect: jest.fn().mockReturnThis(),
            moveTo: jest.fn().mockReturnThis(),
            lineTo: jest.fn().mockReturnThis(),
            closePath: jest.fn().mockReturnThis(),
            fill: jest.fn().mockReturnThis(),
            stroke: jest.fn().mockReturnThis(),
            destroy: jest.fn(),
            removeFromParent: jest.fn(),
            position: { set: jest.fn() },
          })),
          Text: jest.fn().mockImplementation(() => ({
            anchor: { set: jest.fn() },
            destroy: jest.fn(),
          })),
        }));

        const { NodeRenderer } = require("@plugin/presentation/renderers/graph/NodeRenderer");
        const renderer = new NodeRenderer();

        // Create
        const node = renderer.createNode("task-1", "ems__Task", "My Task");
        expect(node).toBeDefined();
        expect(node.style.shape).toBe("roundedRect");

        // Update position and state
        renderer.updateNode("task-1", 100, 200, false, false);
        expect(renderer.getNode("task-1")).toBeDefined();

        // Hover
        renderer.updateNode("task-1", 100, 200, true, false);
        expect(node.isHovered).toBe(true);

        // Select
        renderer.updateNode("task-1", 100, 200, false, true);
        expect(node.isSelected).toBe(true);

        // Change type
        renderer.updateNodeStyle("task-1", "ems__Project");
        expect(node.style.shape).toBe("hexagon");

        // Remove
        renderer.removeNode("task-1");
        expect(renderer.getNode("task-1")).toBeUndefined();

        renderer.destroy();
      });
    });

    it("should support bulk node operations", () => {
      jest.isolateModules(() => {
        jest.doMock("pixi.js", () => ({
          Container: jest.fn().mockImplementation(() => ({
            addChild: jest.fn(),
            removeChild: jest.fn(),
            position: { set: jest.fn() },
            destroy: jest.fn(),
          })),
          Graphics: jest.fn().mockImplementation(() => ({
            clear: jest.fn().mockReturnThis(),
            circle: jest.fn().mockReturnThis(),
            rect: jest.fn().mockReturnThis(),
            roundRect: jest.fn().mockReturnThis(),
            moveTo: jest.fn().mockReturnThis(),
            lineTo: jest.fn().mockReturnThis(),
            closePath: jest.fn().mockReturnThis(),
            fill: jest.fn().mockReturnThis(),
            stroke: jest.fn().mockReturnThis(),
            destroy: jest.fn(),
            removeFromParent: jest.fn(),
            position: { set: jest.fn() },
          })),
          Text: jest.fn().mockImplementation(() => ({
            anchor: { set: jest.fn() },
            destroy: jest.fn(),
          })),
        }));

        const { NodeRenderer } = require("@plugin/presentation/renderers/graph/NodeRenderer");
        const renderer = new NodeRenderer();

        // Create multiple nodes
        const nodeIds = Array.from({ length: 100 }, (_, i) => `node-${i}`);
        for (const id of nodeIds) {
          renderer.createNode(id);
        }

        expect(renderer.getStats().renderedNodeCount).toBe(100);

        // Update all positions
        nodeIds.forEach((id, i) => {
          renderer.updateNode(id, i * 10, i * 5);
        });

        // Clear all
        renderer.clear();
        expect(renderer.getStats().renderedNodeCount).toBe(0);
        expect(renderer.getStats().poolSize).toBe(100);

        renderer.destroy();
      });
    });

    it("should support custom style resolver", () => {
      jest.isolateModules(() => {
        jest.doMock("pixi.js", () => ({
          Container: jest.fn().mockImplementation(() => ({
            addChild: jest.fn(),
            removeChild: jest.fn(),
            position: { set: jest.fn() },
            destroy: jest.fn(),
          })),
          Graphics: jest.fn().mockImplementation(() => ({
            clear: jest.fn().mockReturnThis(),
            circle: jest.fn().mockReturnThis(),
            rect: jest.fn().mockReturnThis(),
            roundRect: jest.fn().mockReturnThis(),
            moveTo: jest.fn().mockReturnThis(),
            lineTo: jest.fn().mockReturnThis(),
            closePath: jest.fn().mockReturnThis(),
            fill: jest.fn().mockReturnThis(),
            stroke: jest.fn().mockReturnThis(),
            destroy: jest.fn(),
            removeFromParent: jest.fn(),
            position: { set: jest.fn() },
          })),
          Text: jest.fn().mockImplementation(() => ({
            anchor: { set: jest.fn() },
            destroy: jest.fn(),
          })),
        }));

        const {
          NodeRenderer,
          NodeStyleResolver,
        } = require("@plugin/presentation/renderers/graph/NodeRenderer");

        const customConfigs = [
          {
            classUri: "custom__Widget",
            displayName: "Widget",
            style: {
              shape: "triangle",
              fillColor: 0xaabbcc,
              radius: 12,
            },
          },
        ];

        const customResolver = new NodeStyleResolver(customConfigs);
        const renderer = new NodeRenderer(customResolver);

        const node = renderer.createNode("widget-1", "custom__Widget");
        expect(node.style.shape).toBe("triangle");
        expect(node.style.fillColor).toBe(0xaabbcc);
        expect(node.style.radius).toBe(12);

        renderer.destroy();
      });
    });
  });
});

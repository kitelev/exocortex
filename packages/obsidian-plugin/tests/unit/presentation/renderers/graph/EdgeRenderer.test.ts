/**
 * EdgeRenderer Unit Tests
 *
 * Tests for:
 * - EdgeVisualStyle defaults
 * - EdgeStyleResolver type resolution
 * - Curve calculation (straight, quadratic, bezier, arc)
 * - Arrow drawing (arrow, diamond, circle)
 * - EdgeRenderer edge lifecycle (create, update, remove)
 * - Object pooling
 * - Edge endpoint calculation
 */

import {
  EdgeStyleResolver,
  DEFAULT_EDGE_STYLE,
  DEFAULT_EDGE_TYPE_CONFIGS,
  calculateEdgeEndpoints,
  type EdgeTypeConfig,
  type CurveType,
  type ArrowType,
  type Position,
} from "@plugin/presentation/renderers/graph/EdgeRenderer";

describe("EdgeRenderer Module", () => {
  describe("DEFAULT_EDGE_STYLE", () => {
    it("should have correct default line width", () => {
      expect(DEFAULT_EDGE_STYLE.width).toBe(1);
    });

    it("should have correct default color", () => {
      expect(DEFAULT_EDGE_STYLE.color).toBe(0x9ca3af);
    });

    it("should have correct default alpha", () => {
      expect(DEFAULT_EDGE_STYLE.alpha).toBe(0.6);
    });

    it("should have straight curve type by default", () => {
      expect(DEFAULT_EDGE_STYLE.curveType).toBe("straight");
    });

    it("should have zero curvature by default", () => {
      expect(DEFAULT_EDGE_STYLE.curvature).toBe(0);
    });

    it("should have arrow type by default", () => {
      expect(DEFAULT_EDGE_STYLE.arrowType).toBe("arrow");
    });

    it("should have correct default arrow size", () => {
      expect(DEFAULT_EDGE_STYLE.arrowSize).toBe(6);
    });

    it("should have end arrow position by default", () => {
      expect(DEFAULT_EDGE_STYLE.arrowPosition).toBe("end");
    });

    it("should not be bidirectional by default", () => {
      expect(DEFAULT_EDGE_STYLE.bidirectional).toBe(false);
    });

    it("should have hover state settings", () => {
      expect(DEFAULT_EDGE_STYLE.hoverWidth).toBe(2);
      expect(DEFAULT_EDGE_STYLE.hoverColor).toBe(0x60a5fa);
    });

    it("should have selected state settings", () => {
      expect(DEFAULT_EDGE_STYLE.selectedWidth).toBe(2);
      expect(DEFAULT_EDGE_STYLE.selectedColor).toBe(0xfbbf24);
    });
  });

  describe("DEFAULT_EDGE_TYPE_CONFIGS", () => {
    it("should have configuration for Effort_parent", () => {
      const parentConfig = DEFAULT_EDGE_TYPE_CONFIGS.find(
        (c) => c.predicateUri === "ems__Effort_parent"
      );
      expect(parentConfig).toBeDefined();
      expect(parentConfig?.style.color).toBe(0x22c55e);
      expect(parentConfig?.style.arrowType).toBe("arrow");
    });

    it("should have configuration for Asset_prototype", () => {
      const prototypeConfig = DEFAULT_EDGE_TYPE_CONFIGS.find(
        (c) => c.predicateUri === "exo__Asset_prototype"
      );
      expect(prototypeConfig).toBeDefined();
      expect(prototypeConfig?.style.color).toBe(0x8b5cf6);
      expect(prototypeConfig?.style.arrowType).toBe("diamond");
      expect(prototypeConfig?.style.curveType).toBe("quadratic");
    });

    it("should have configuration for Task_blockedBy", () => {
      const blockedConfig = DEFAULT_EDGE_TYPE_CONFIGS.find(
        (c) => c.predicateUri === "ems__Task_blockedBy"
      );
      expect(blockedConfig).toBeDefined();
      expect(blockedConfig?.style.color).toBe(0xef4444);
      expect(blockedConfig?.style.dashArray).toEqual([4, 2]);
    });

    it("should have configuration for Asset_relatedTo", () => {
      const relatedConfig = DEFAULT_EDGE_TYPE_CONFIGS.find(
        (c) => c.predicateUri === "exo__Asset_relatedTo"
      );
      expect(relatedConfig).toBeDefined();
      expect(relatedConfig?.style.color).toBe(0x6b7280);
      expect(relatedConfig?.style.arrowType).toBe("none");
      expect(relatedConfig?.style.curveType).toBe("bezier");
    });
  });

  describe("EdgeStyleResolver", () => {
    let resolver: EdgeStyleResolver;

    beforeEach(() => {
      resolver = new EdgeStyleResolver();
    });

    describe("resolveStyle", () => {
      it("should return default style for undefined predicate", () => {
        const style = resolver.resolveStyle(undefined);
        expect(style.curveType).toBe("straight");
        expect(style.width).toBe(1);
      });

      it("should return default style for unknown predicate", () => {
        const style = resolver.resolveStyle("unknown__Predicate");
        expect(style.curveType).toBe("straight");
        expect(style.width).toBe(1);
      });

      it("should resolve Effort_parent style", () => {
        const style = resolver.resolveStyle("ems__Effort_parent");
        expect(style.color).toBe(0x22c55e);
        expect(style.arrowType).toBe("arrow");
      });

      it("should resolve Asset_prototype style", () => {
        const style = resolver.resolveStyle("exo__Asset_prototype");
        expect(style.color).toBe(0x8b5cf6);
        expect(style.arrowType).toBe("diamond");
        expect(style.curveType).toBe("quadratic");
      });

      it("should resolve Task_blockedBy style", () => {
        const style = resolver.resolveStyle("ems__Task_blockedBy");
        expect(style.color).toBe(0xef4444);
        expect(style.dashArray).toEqual([4, 2]);
      });

      it("should resolve Asset_relatedTo style", () => {
        const style = resolver.resolveStyle("exo__Asset_relatedTo");
        expect(style.color).toBe(0x6b7280);
        expect(style.arrowType).toBe("none");
        expect(style.curveType).toBe("bezier");
      });

      it("should merge with default style", () => {
        const style = resolver.resolveStyle("ems__Effort_parent");
        // Should have predicate-specific properties
        expect(style.color).toBe(0x22c55e);
        // Should also have default properties not overridden
        expect(style.width).toBe(1);
        expect(style.arrowSize).toBe(6);
      });
    });

    describe("registerType", () => {
      it("should register a new type configuration", () => {
        const customConfig: EdgeTypeConfig = {
          predicateUri: "custom__Relation",
          displayName: "Custom",
          style: {
            curveType: "arc",
            color: 0xff0000,
            curvature: 0.5,
          },
        };

        resolver.registerType(customConfig);
        const style = resolver.resolveStyle("custom__Relation");

        expect(style.curveType).toBe("arc");
        expect(style.color).toBe(0xff0000);
        expect(style.curvature).toBe(0.5);
      });

      it("should override existing type configuration", () => {
        const overrideConfig: EdgeTypeConfig = {
          predicateUri: "ems__Effort_parent",
          displayName: "Custom Parent",
          style: {
            color: 0x00ff00,
            arrowType: "circle",
          },
        };

        resolver.registerType(overrideConfig);
        const style = resolver.resolveStyle("ems__Effort_parent");

        expect(style.color).toBe(0x00ff00);
        expect(style.arrowType).toBe("circle");
      });
    });

    describe("getTypeConfigs", () => {
      it("should return all type configurations", () => {
        const configs = resolver.getTypeConfigs();
        expect(configs.length).toBe(4); // Default configs
      });

      it("should include newly registered types", () => {
        resolver.registerType({
          predicateUri: "custom__Type",
          displayName: "Custom",
          style: { curveType: "arc" },
        });

        const configs = resolver.getTypeConfigs();
        expect(configs.length).toBe(5);
      });
    });

    describe("setDefaultStyle", () => {
      it("should update default style", () => {
        resolver.setDefaultStyle({ width: 3, color: 0xff0000 });
        const defaultStyle = resolver.getDefaultStyle();

        expect(defaultStyle.width).toBe(3);
        expect(defaultStyle.color).toBe(0xff0000);
        // Other defaults should remain
        expect(defaultStyle.curveType).toBe("straight");
      });

      it("should affect unregistered predicate resolution", () => {
        resolver.setDefaultStyle({ width: 4 });
        const style = resolver.resolveStyle("unknown__Type");

        expect(style.width).toBe(4);
      });
    });

    describe("custom type configurations", () => {
      it("should accept custom type configs in constructor", () => {
        const customConfigs: EdgeTypeConfig[] = [
          {
            predicateUri: "custom__Alpha",
            displayName: "Alpha",
            style: { curveType: "bezier", color: 0x111111 },
          },
          {
            predicateUri: "custom__Beta",
            displayName: "Beta",
            style: { curveType: "arc", color: 0x222222 },
          },
        ];

        const customResolver = new EdgeStyleResolver(customConfigs);

        const alphaStyle = customResolver.resolveStyle("custom__Alpha");
        expect(alphaStyle.curveType).toBe("bezier");
        expect(alphaStyle.color).toBe(0x111111);

        const betaStyle = customResolver.resolveStyle("custom__Beta");
        expect(betaStyle.curveType).toBe("arc");
        expect(betaStyle.color).toBe(0x222222);

        // Should not have default configs
        const parentStyle = customResolver.resolveStyle("ems__Effort_parent");
        expect(parentStyle.curveType).toBe("straight"); // Falls back to default
      });
    });
  });

  describe("calculateEdgeEndpoints", () => {
    it("should adjust endpoints for node radii", () => {
      const source: Position = { x: 0, y: 0 };
      const target: Position = { x: 100, y: 0 };

      const result = calculateEdgeEndpoints(source, target, 10, 10);

      expect(result.source.x).toBe(10);
      expect(result.source.y).toBe(0);
      expect(result.target.x).toBe(90);
      expect(result.target.y).toBe(0);
    });

    it("should handle vertical edges", () => {
      const source: Position = { x: 0, y: 0 };
      const target: Position = { x: 0, y: 100 };

      const result = calculateEdgeEndpoints(source, target, 10, 10);

      expect(result.source.x).toBe(0);
      expect(result.source.y).toBe(10);
      expect(result.target.x).toBe(0);
      expect(result.target.y).toBe(90);
    });

    it("should handle diagonal edges", () => {
      const source: Position = { x: 0, y: 0 };
      const target: Position = { x: 100, y: 100 };

      const result = calculateEdgeEndpoints(source, target, 10, 10);

      // Distance is ~141.4, so offset is ~7.07 in each direction
      expect(result.source.x).toBeCloseTo(7.07, 1);
      expect(result.source.y).toBeCloseTo(7.07, 1);
      expect(result.target.x).toBeCloseTo(92.93, 1);
      expect(result.target.y).toBeCloseTo(92.93, 1);
    });

    it("should handle different radii", () => {
      const source: Position = { x: 0, y: 0 };
      const target: Position = { x: 100, y: 0 };

      const result = calculateEdgeEndpoints(source, target, 15, 5);

      expect(result.source.x).toBe(15);
      expect(result.target.x).toBe(95);
    });

    it("should handle zero distance", () => {
      const source: Position = { x: 50, y: 50 };
      const target: Position = { x: 50, y: 50 };

      const result = calculateEdgeEndpoints(source, target, 10, 10);

      expect(result.source).toEqual(source);
      expect(result.target).toEqual(target);
    });
  });

  describe("EdgeRenderer with mocked PixiJS", () => {
    // These tests use jest.isolateModules because Jest's resetMocks: true
    // interferes with complex mock structures for PixiJS

    it("should create an EdgeRenderer instance", () => {
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
            moveTo: jest.fn().mockReturnThis(),
            lineTo: jest.fn().mockReturnThis(),
            quadraticCurveTo: jest.fn().mockReturnThis(),
            bezierCurveTo: jest.fn().mockReturnThis(),
            circle: jest.fn().mockReturnThis(),
            closePath: jest.fn().mockReturnThis(),
            stroke: jest.fn().mockReturnThis(),
            fill: jest.fn().mockReturnThis(),
            setStrokeStyle: jest.fn().mockReturnThis(),
            destroy: jest.fn(),
            removeFromParent: jest.fn(),
            position: { set: jest.fn() },
          })),
        }));

        const { EdgeRenderer } = require("@plugin/presentation/renderers/graph/EdgeRenderer");
        const renderer = new EdgeRenderer();
        expect(renderer).toBeDefined();
        expect(renderer.getStats().renderedEdgeCount).toBe(0);
        renderer.destroy();
      });
    });

    it("should create and manage edges", () => {
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
            moveTo: jest.fn().mockReturnThis(),
            lineTo: jest.fn().mockReturnThis(),
            quadraticCurveTo: jest.fn().mockReturnThis(),
            bezierCurveTo: jest.fn().mockReturnThis(),
            circle: jest.fn().mockReturnThis(),
            closePath: jest.fn().mockReturnThis(),
            stroke: jest.fn().mockReturnThis(),
            fill: jest.fn().mockReturnThis(),
            setStrokeStyle: jest.fn().mockReturnThis(),
            destroy: jest.fn(),
            removeFromParent: jest.fn(),
            position: { set: jest.fn() },
          })),
        }));

        const { EdgeRenderer } = require("@plugin/presentation/renderers/graph/EdgeRenderer");
        const renderer = new EdgeRenderer();

        // Create edges
        const edge1 = renderer.createEdge(
          "edge-1",
          "node-a",
          "node-b",
          { x: 0, y: 0 },
          { x: 100, y: 100 },
          "ems__Effort_parent"
        );
        const edge2 = renderer.createEdge(
          "edge-2",
          "node-b",
          "node-c",
          { x: 100, y: 100 },
          { x: 200, y: 50 },
          "exo__Asset_prototype"
        );

        expect(edge1.edgeId).toBe("edge-1");
        expect(edge1.style.color).toBe(0x22c55e);
        expect(edge2.edgeId).toBe("edge-2");
        expect(edge2.style.arrowType).toBe("diamond");
        expect(renderer.getStats().renderedEdgeCount).toBe(2);

        // Remove edge
        renderer.removeEdge("edge-1");
        expect(renderer.getEdge("edge-1")).toBeUndefined();
        expect(renderer.getStats().renderedEdgeCount).toBe(1);

        renderer.destroy();
      });
    });

    it("should update edge positions and states", () => {
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
            moveTo: jest.fn().mockReturnThis(),
            lineTo: jest.fn().mockReturnThis(),
            quadraticCurveTo: jest.fn().mockReturnThis(),
            bezierCurveTo: jest.fn().mockReturnThis(),
            circle: jest.fn().mockReturnThis(),
            closePath: jest.fn().mockReturnThis(),
            stroke: jest.fn().mockReturnThis(),
            fill: jest.fn().mockReturnThis(),
            setStrokeStyle: jest.fn().mockReturnThis(),
            destroy: jest.fn(),
            removeFromParent: jest.fn(),
            position: { set: jest.fn() },
          })),
        }));

        const { EdgeRenderer } = require("@plugin/presentation/renderers/graph/EdgeRenderer");
        const renderer = new EdgeRenderer();

        const edge = renderer.createEdge(
          "edge-1",
          "node-a",
          "node-b",
          { x: 0, y: 0 },
          { x: 100, y: 100 }
        );

        // Update with new position
        renderer.updateEdge(
          "edge-1",
          { x: 10, y: 10 },
          { x: 110, y: 110 },
          true,
          false
        );

        expect(edge.isHovered).toBe(true);
        expect(edge.isSelected).toBe(false);
        expect(edge.sourcePosition).toEqual({ x: 10, y: 10 });
        expect(edge.targetPosition).toEqual({ x: 110, y: 110 });

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
            moveTo: jest.fn().mockReturnThis(),
            lineTo: jest.fn().mockReturnThis(),
            quadraticCurveTo: jest.fn().mockReturnThis(),
            bezierCurveTo: jest.fn().mockReturnThis(),
            circle: jest.fn().mockReturnThis(),
            closePath: jest.fn().mockReturnThis(),
            stroke: jest.fn().mockReturnThis(),
            fill: jest.fn().mockReturnThis(),
            setStrokeStyle: jest.fn().mockReturnThis(),
            destroy: jest.fn(),
            removeFromParent: jest.fn(),
            position: { set: jest.fn() },
          })),
        }));

        const { EdgeRenderer } = require("@plugin/presentation/renderers/graph/EdgeRenderer");
        const renderer = new EdgeRenderer();

        // Create and remove edges to populate pool
        renderer.createEdge("edge-1", "a", "b", { x: 0, y: 0 }, { x: 100, y: 0 });
        renderer.createEdge("edge-2", "b", "c", { x: 100, y: 0 }, { x: 200, y: 0 });
        renderer.removeEdge("edge-1");
        renderer.removeEdge("edge-2");

        // Pool should have 4 graphics (2 line + 2 arrow per edge)
        expect(renderer.getStats().poolSize).toBe(4);
        expect(renderer.getStats().renderedEdgeCount).toBe(0);

        // Create new edge - should reuse from pool
        renderer.createEdge("edge-3", "c", "d", { x: 200, y: 0 }, { x: 300, y: 0 });
        expect(renderer.getStats().poolSize).toBe(2);
        expect(renderer.getStats().renderedEdgeCount).toBe(1);

        renderer.destroy();
      });
    });

    it("should clear all edges", () => {
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
            moveTo: jest.fn().mockReturnThis(),
            lineTo: jest.fn().mockReturnThis(),
            quadraticCurveTo: jest.fn().mockReturnThis(),
            bezierCurveTo: jest.fn().mockReturnThis(),
            circle: jest.fn().mockReturnThis(),
            closePath: jest.fn().mockReturnThis(),
            stroke: jest.fn().mockReturnThis(),
            fill: jest.fn().mockReturnThis(),
            setStrokeStyle: jest.fn().mockReturnThis(),
            destroy: jest.fn(),
            removeFromParent: jest.fn(),
            position: { set: jest.fn() },
          })),
        }));

        const { EdgeRenderer } = require("@plugin/presentation/renderers/graph/EdgeRenderer");
        const renderer = new EdgeRenderer();

        renderer.createEdge("edge-1", "a", "b", { x: 0, y: 0 }, { x: 100, y: 0 });
        renderer.createEdge("edge-2", "b", "c", { x: 100, y: 0 }, { x: 200, y: 0 });
        renderer.createEdge("edge-3", "c", "d", { x: 200, y: 0 }, { x: 300, y: 0 });

        expect(renderer.getAllEdges().length).toBe(3);

        renderer.clear();

        expect(renderer.getAllEdges().length).toBe(0);
        expect(renderer.getStats().poolSize).toBe(6); // 3 edges * 2 graphics each

        renderer.destroy();
      });
    });

    it("should get edges for a specific node", () => {
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
            moveTo: jest.fn().mockReturnThis(),
            lineTo: jest.fn().mockReturnThis(),
            quadraticCurveTo: jest.fn().mockReturnThis(),
            bezierCurveTo: jest.fn().mockReturnThis(),
            circle: jest.fn().mockReturnThis(),
            closePath: jest.fn().mockReturnThis(),
            stroke: jest.fn().mockReturnThis(),
            fill: jest.fn().mockReturnThis(),
            setStrokeStyle: jest.fn().mockReturnThis(),
            destroy: jest.fn(),
            removeFromParent: jest.fn(),
            position: { set: jest.fn() },
          })),
        }));

        const { EdgeRenderer } = require("@plugin/presentation/renderers/graph/EdgeRenderer");
        const renderer = new EdgeRenderer();

        renderer.createEdge("edge-1", "a", "b", { x: 0, y: 0 }, { x: 100, y: 0 });
        renderer.createEdge("edge-2", "b", "c", { x: 100, y: 0 }, { x: 200, y: 0 });
        renderer.createEdge("edge-3", "c", "d", { x: 200, y: 0 }, { x: 300, y: 0 });

        const edgesForB = renderer.getEdgesForNode("b");
        expect(edgesForB.length).toBe(2);
        expect(edgesForB.map((e: { edgeId: string }) => e.edgeId).sort()).toEqual(["edge-1", "edge-2"]);

        const edgesForD = renderer.getEdgesForNode("d");
        expect(edgesForD.length).toBe(1);
        expect(edgesForD[0].edgeId).toBe("edge-3");

        renderer.destroy();
      });
    });
  });

  describe("Curve calculation", () => {
    it("should calculate straight curve correctly", () => {
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
            moveTo: jest.fn().mockReturnThis(),
            lineTo: jest.fn().mockReturnThis(),
            quadraticCurveTo: jest.fn().mockReturnThis(),
            bezierCurveTo: jest.fn().mockReturnThis(),
            circle: jest.fn().mockReturnThis(),
            closePath: jest.fn().mockReturnThis(),
            stroke: jest.fn().mockReturnThis(),
            fill: jest.fn().mockReturnThis(),
            setStrokeStyle: jest.fn().mockReturnThis(),
            destroy: jest.fn(),
            removeFromParent: jest.fn(),
            position: { set: jest.fn() },
          })),
        }));

        const { EdgeRenderer, EdgeStyleResolver, DEFAULT_EDGE_STYLE } = require("@plugin/presentation/renderers/graph/EdgeRenderer");
        const renderer = new EdgeRenderer();

        const source = { x: 0, y: 0 };
        const target = { x: 100, y: 0 };
        const style = { ...DEFAULT_EDGE_STYLE, curveType: "straight" as CurveType };

        const curve = renderer.calculateCurve(source, target, style);

        expect(curve.source).toEqual(source);
        expect(curve.target).toEqual(target);
        expect(curve.control1).toBeUndefined();
        expect(curve.control2).toBeUndefined();

        renderer.destroy();
      });
    });

    it("should calculate quadratic curve with control point", () => {
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
            moveTo: jest.fn().mockReturnThis(),
            lineTo: jest.fn().mockReturnThis(),
            quadraticCurveTo: jest.fn().mockReturnThis(),
            bezierCurveTo: jest.fn().mockReturnThis(),
            circle: jest.fn().mockReturnThis(),
            closePath: jest.fn().mockReturnThis(),
            stroke: jest.fn().mockReturnThis(),
            fill: jest.fn().mockReturnThis(),
            setStrokeStyle: jest.fn().mockReturnThis(),
            destroy: jest.fn(),
            removeFromParent: jest.fn(),
            position: { set: jest.fn() },
          })),
        }));

        const { EdgeRenderer, DEFAULT_EDGE_STYLE } = require("@plugin/presentation/renderers/graph/EdgeRenderer");
        const renderer = new EdgeRenderer();

        const source = { x: 0, y: 0 };
        const target = { x: 100, y: 0 };
        const style = { ...DEFAULT_EDGE_STYLE, curveType: "quadratic" as CurveType, curvature: 0.5 };

        const curve = renderer.calculateCurve(source, target, style);

        expect(curve.source).toEqual(source);
        expect(curve.target).toEqual(target);
        expect(curve.control1).toBeDefined();
        expect(curve.control1?.x).toBe(50); // Midpoint X
        // Perpendicular offset: for horizontal line, offset is vertical
        // Direction depends on sign of perpendicular vector (dx=100, dy=0 -> perpX=0, perpY=1)
        expect(Math.abs(curve.control1?.y ?? 0)).toBe(25); // Offset perpendicular to line

        renderer.destroy();
      });
    });

    it("should calculate bezier curve with two control points", () => {
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
            moveTo: jest.fn().mockReturnThis(),
            lineTo: jest.fn().mockReturnThis(),
            quadraticCurveTo: jest.fn().mockReturnThis(),
            bezierCurveTo: jest.fn().mockReturnThis(),
            circle: jest.fn().mockReturnThis(),
            closePath: jest.fn().mockReturnThis(),
            stroke: jest.fn().mockReturnThis(),
            fill: jest.fn().mockReturnThis(),
            setStrokeStyle: jest.fn().mockReturnThis(),
            destroy: jest.fn(),
            removeFromParent: jest.fn(),
            position: { set: jest.fn() },
          })),
        }));

        const { EdgeRenderer, DEFAULT_EDGE_STYLE } = require("@plugin/presentation/renderers/graph/EdgeRenderer");
        const renderer = new EdgeRenderer();

        const source = { x: 0, y: 0 };
        const target = { x: 100, y: 0 };
        const style = { ...DEFAULT_EDGE_STYLE, curveType: "bezier" as CurveType, curvature: 0.5 };

        const curve = renderer.calculateCurve(source, target, style);

        expect(curve.source).toEqual(source);
        expect(curve.target).toEqual(target);
        expect(curve.control1).toBeDefined();
        expect(curve.control2).toBeDefined();
        expect(curve.control1?.x).toBe(25); // Quarter point X
        expect(curve.control2?.x).toBe(75); // Three-quarter point X

        renderer.destroy();
      });
    });
  });

  describe("Point on curve calculation", () => {
    it("should calculate point on straight line", () => {
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
            moveTo: jest.fn().mockReturnThis(),
            lineTo: jest.fn().mockReturnThis(),
            quadraticCurveTo: jest.fn().mockReturnThis(),
            bezierCurveTo: jest.fn().mockReturnThis(),
            circle: jest.fn().mockReturnThis(),
            closePath: jest.fn().mockReturnThis(),
            stroke: jest.fn().mockReturnThis(),
            fill: jest.fn().mockReturnThis(),
            setStrokeStyle: jest.fn().mockReturnThis(),
            destroy: jest.fn(),
            removeFromParent: jest.fn(),
            position: { set: jest.fn() },
          })),
        }));

        const { EdgeRenderer } = require("@plugin/presentation/renderers/graph/EdgeRenderer");
        const renderer = new EdgeRenderer();

        const curve = {
          source: { x: 0, y: 0 },
          target: { x: 100, y: 0 },
        };

        const midPoint = renderer.getPointOnCurve(curve, 0.5, "straight");
        expect(midPoint.position.x).toBe(50);
        expect(midPoint.position.y).toBe(0);
        expect(midPoint.angle).toBe(0); // Horizontal line

        const endPoint = renderer.getPointOnCurve(curve, 1, "straight");
        expect(endPoint.position.x).toBe(100);
        expect(endPoint.position.y).toBe(0);

        renderer.destroy();
      });
    });
  });

  describe("integration scenarios", () => {
    it("should support complete edge lifecycle", () => {
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
            moveTo: jest.fn().mockReturnThis(),
            lineTo: jest.fn().mockReturnThis(),
            quadraticCurveTo: jest.fn().mockReturnThis(),
            bezierCurveTo: jest.fn().mockReturnThis(),
            circle: jest.fn().mockReturnThis(),
            closePath: jest.fn().mockReturnThis(),
            stroke: jest.fn().mockReturnThis(),
            fill: jest.fn().mockReturnThis(),
            setStrokeStyle: jest.fn().mockReturnThis(),
            destroy: jest.fn(),
            removeFromParent: jest.fn(),
            position: { set: jest.fn() },
          })),
        }));

        const { EdgeRenderer } = require("@plugin/presentation/renderers/graph/EdgeRenderer");
        const renderer = new EdgeRenderer();

        // Create
        const edge = renderer.createEdge(
          "parent-edge-1",
          "task-1",
          "project-1",
          { x: 0, y: 0 },
          { x: 100, y: 100 },
          "ems__Effort_parent"
        );
        expect(edge).toBeDefined();
        expect(edge.style.color).toBe(0x22c55e);

        // Update position
        renderer.updateEdge(
          "parent-edge-1",
          { x: 10, y: 10 },
          { x: 110, y: 110 },
          false,
          false
        );
        expect(renderer.getEdge("parent-edge-1")).toBeDefined();

        // Hover
        renderer.updateEdge(
          "parent-edge-1",
          { x: 10, y: 10 },
          { x: 110, y: 110 },
          true,
          false
        );
        expect(edge.isHovered).toBe(true);

        // Select
        renderer.updateEdge(
          "parent-edge-1",
          { x: 10, y: 10 },
          { x: 110, y: 110 },
          false,
          true
        );
        expect(edge.isSelected).toBe(true);

        // Change type
        renderer.updateEdgeStyle("parent-edge-1", "exo__Asset_prototype");
        expect(edge.style.arrowType).toBe("diamond");

        // Remove
        renderer.removeEdge("parent-edge-1");
        expect(renderer.getEdge("parent-edge-1")).toBeUndefined();

        renderer.destroy();
      });
    });

    it("should support bulk edge operations", () => {
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
            moveTo: jest.fn().mockReturnThis(),
            lineTo: jest.fn().mockReturnThis(),
            quadraticCurveTo: jest.fn().mockReturnThis(),
            bezierCurveTo: jest.fn().mockReturnThis(),
            circle: jest.fn().mockReturnThis(),
            closePath: jest.fn().mockReturnThis(),
            stroke: jest.fn().mockReturnThis(),
            fill: jest.fn().mockReturnThis(),
            setStrokeStyle: jest.fn().mockReturnThis(),
            destroy: jest.fn(),
            removeFromParent: jest.fn(),
            position: { set: jest.fn() },
          })),
        }));

        const { EdgeRenderer } = require("@plugin/presentation/renderers/graph/EdgeRenderer");
        const renderer = new EdgeRenderer();

        // Create multiple edges
        const edgeIds = Array.from({ length: 100 }, (_, i) => `edge-${i}`);
        for (const id of edgeIds) {
          const idx = parseInt(id.split("-")[1]);
          renderer.createEdge(
            id,
            `node-${idx}`,
            `node-${idx + 1}`,
            { x: idx * 10, y: 0 },
            { x: (idx + 1) * 10, y: 0 }
          );
        }

        expect(renderer.getStats().renderedEdgeCount).toBe(100);

        // Update all positions
        edgeIds.forEach((id, i) => {
          renderer.updateEdge(
            id,
            { x: i * 10, y: i * 5 },
            { x: (i + 1) * 10, y: (i + 1) * 5 }
          );
        });

        // Clear all
        renderer.clear();
        expect(renderer.getStats().renderedEdgeCount).toBe(0);
        expect(renderer.getStats().poolSize).toBe(200); // 100 edges * 2 graphics each

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
            moveTo: jest.fn().mockReturnThis(),
            lineTo: jest.fn().mockReturnThis(),
            quadraticCurveTo: jest.fn().mockReturnThis(),
            bezierCurveTo: jest.fn().mockReturnThis(),
            circle: jest.fn().mockReturnThis(),
            closePath: jest.fn().mockReturnThis(),
            stroke: jest.fn().mockReturnThis(),
            fill: jest.fn().mockReturnThis(),
            setStrokeStyle: jest.fn().mockReturnThis(),
            destroy: jest.fn(),
            removeFromParent: jest.fn(),
            position: { set: jest.fn() },
          })),
        }));

        const {
          EdgeRenderer,
          EdgeStyleResolver,
        } = require("@plugin/presentation/renderers/graph/EdgeRenderer");

        const customConfigs = [
          {
            predicateUri: "custom__Connection",
            displayName: "Connection",
            style: {
              curveType: "arc",
              color: 0xaabbcc,
              arrowType: "circle",
              curvature: 0.4,
            },
          },
        ];

        const customResolver = new EdgeStyleResolver(customConfigs);
        const renderer = new EdgeRenderer(customResolver);

        const edge = renderer.createEdge(
          "conn-1",
          "a",
          "b",
          { x: 0, y: 0 },
          { x: 100, y: 100 },
          "custom__Connection"
        );
        expect(edge.style.curveType).toBe("arc");
        expect(edge.style.color).toBe(0xaabbcc);
        expect(edge.style.arrowType).toBe("circle");
        expect(edge.style.curvature).toBe(0.4);

        renderer.destroy();
      });
    });
  });
});

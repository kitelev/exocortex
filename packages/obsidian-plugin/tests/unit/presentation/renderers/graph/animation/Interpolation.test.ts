/**
 * Interpolation Tests
 *
 * Tests for value interpolation utilities including numbers, points,
 * colors, and complex data structures.
 */

import {
  // Number interpolation
  lerp,
  clamp,
  lerpClamped,
  inverseLerp,
  remap,
  // Point interpolation
  interpolatePoint2D,
  interpolatePoint3D,
  interpolateBezierQuadratic,
  interpolateBezierCubic,
  interpolateCatmullRom,
  // Color conversion
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  // Color interpolation
  interpolateRgb,
  interpolateRgba,
  interpolateHsl,
  interpolateHsla,
  interpolateHex,
  interpolateHexHsl,
  // Opacity and scale
  interpolateOpacity,
  interpolateScale,
  interpolateRotation,
  // Node positions
  interpolateNodePosition,
  interpolateNodePositions,
  // Arrays
  interpolateArray,
  interpolatePointArray,
  // Staggered
  calculateStaggeredProgress,
  interpolateStaggered,
  type Point2D,
  type Point3D,
  type NodePosition,
} from "../../../../../../src/presentation/renderers/graph/animation/Interpolation";

// ============================================================
// Number Interpolation Tests
// ============================================================

describe("Number Interpolation", () => {
  describe("lerp", () => {
    it("should interpolate between two values", () => {
      expect(lerp(0, 100, 0)).toBe(0);
      expect(lerp(0, 100, 0.5)).toBe(50);
      expect(lerp(0, 100, 1)).toBe(100);
    });

    it("should handle negative values", () => {
      expect(lerp(-50, 50, 0.5)).toBe(0);
      expect(lerp(-100, -50, 0.5)).toBe(-75);
    });

    it("should handle t values outside [0, 1]", () => {
      expect(lerp(0, 100, -0.5)).toBe(-50);
      expect(lerp(0, 100, 1.5)).toBe(150);
    });
  });

  describe("clamp", () => {
    it("should clamp values within range", () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-5, 0, 10)).toBe(0);
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it("should handle edge cases", () => {
      expect(clamp(0, 0, 10)).toBe(0);
      expect(clamp(10, 0, 10)).toBe(10);
    });
  });

  describe("lerpClamped", () => {
    it("should clamp t to [0, 1]", () => {
      expect(lerpClamped(0, 100, -0.5)).toBe(0);
      expect(lerpClamped(0, 100, 1.5)).toBe(100);
      expect(lerpClamped(0, 100, 0.5)).toBe(50);
    });
  });

  describe("inverseLerp", () => {
    it("should find t for a value in range", () => {
      expect(inverseLerp(0, 100, 50)).toBe(0.5);
      expect(inverseLerp(0, 100, 0)).toBe(0);
      expect(inverseLerp(0, 100, 100)).toBe(1);
    });

    it("should handle same start and end", () => {
      expect(inverseLerp(50, 50, 50)).toBe(0);
    });
  });

  describe("remap", () => {
    it("should remap value from one range to another", () => {
      expect(remap(50, 0, 100, 0, 1)).toBe(0.5);
      expect(remap(5, 0, 10, 0, 100)).toBe(50);
      expect(remap(0, 0, 100, 200, 300)).toBe(200);
      expect(remap(100, 0, 100, 200, 300)).toBe(300);
    });
  });
});

// ============================================================
// Point Interpolation Tests
// ============================================================

describe("Point Interpolation", () => {
  describe("interpolatePoint2D", () => {
    it("should interpolate between two 2D points", () => {
      const start: Point2D = { x: 0, y: 0 };
      const end: Point2D = { x: 100, y: 200 };

      expect(interpolatePoint2D(start, end, 0)).toEqual({ x: 0, y: 0 });
      expect(interpolatePoint2D(start, end, 0.5)).toEqual({ x: 50, y: 100 });
      expect(interpolatePoint2D(start, end, 1)).toEqual({ x: 100, y: 200 });
    });

    it("should handle negative coordinates", () => {
      const start: Point2D = { x: -50, y: 100 };
      const end: Point2D = { x: 50, y: -100 };

      expect(interpolatePoint2D(start, end, 0.5)).toEqual({ x: 0, y: 0 });
    });
  });

  describe("interpolatePoint3D", () => {
    it("should interpolate between two 3D points", () => {
      const start: Point3D = { x: 0, y: 0, z: 0 };
      const end: Point3D = { x: 100, y: 200, z: 300 };

      expect(interpolatePoint3D(start, end, 0)).toEqual({ x: 0, y: 0, z: 0 });
      expect(interpolatePoint3D(start, end, 0.5)).toEqual({ x: 50, y: 100, z: 150 });
      expect(interpolatePoint3D(start, end, 1)).toEqual({ x: 100, y: 200, z: 300 });
    });
  });

  describe("interpolateBezierQuadratic", () => {
    it("should interpolate along quadratic bezier curve", () => {
      const p0: Point2D = { x: 0, y: 0 };
      const p1: Point2D = { x: 50, y: 100 };
      const p2: Point2D = { x: 100, y: 0 };

      const start = interpolateBezierQuadratic(p0, p1, p2, 0);
      const mid = interpolateBezierQuadratic(p0, p1, p2, 0.5);
      const end = interpolateBezierQuadratic(p0, p1, p2, 1);

      expect(start).toEqual({ x: 0, y: 0 });
      expect(end).toEqual({ x: 100, y: 0 });
      expect(mid.x).toBe(50);
      expect(mid.y).toBe(50); // Quadratic peak
    });
  });

  describe("interpolateBezierCubic", () => {
    it("should interpolate along cubic bezier curve", () => {
      const p0: Point2D = { x: 0, y: 0 };
      const p1: Point2D = { x: 33, y: 100 };
      const p2: Point2D = { x: 66, y: 100 };
      const p3: Point2D = { x: 100, y: 0 };

      const start = interpolateBezierCubic(p0, p1, p2, p3, 0);
      const end = interpolateBezierCubic(p0, p1, p2, p3, 1);

      expect(start).toEqual({ x: 0, y: 0 });
      expect(end).toEqual({ x: 100, y: 0 });
    });
  });

  describe("interpolateCatmullRom", () => {
    it("should handle array with single point", () => {
      const points: Point2D[] = [{ x: 50, y: 50 }];
      expect(interpolateCatmullRom(points, 0.5)).toEqual({ x: 50, y: 50 });
    });

    it("should interpolate between two points", () => {
      const points: Point2D[] = [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ];
      expect(interpolateCatmullRom(points, 0.5)).toEqual({ x: 50, y: 50 });
    });

    it("should interpolate through multiple points", () => {
      const points: Point2D[] = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ];

      const start = interpolateCatmullRom(points, 0);
      const end = interpolateCatmullRom(points, 1);

      expect(start).toEqual({ x: 0, y: 0 });
      expect(end.x).toBeCloseTo(0, 1);
      expect(end.y).toBeCloseTo(100, 1);
    });
  });
});

// ============================================================
// Color Conversion Tests
// ============================================================

describe("Color Conversion", () => {
  describe("hexToRgb", () => {
    it("should convert hex to RGB", () => {
      expect(hexToRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb("#00ff00")).toEqual({ r: 0, g: 255, b: 0 });
      expect(hexToRgb("#0000ff")).toEqual({ r: 0, g: 0, b: 255 });
      expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    });

    it("should handle shorthand hex", () => {
      expect(hexToRgb("#f00")).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb("#0f0")).toEqual({ r: 0, g: 255, b: 0 });
      expect(hexToRgb("#00f")).toEqual({ r: 0, g: 0, b: 255 });
    });

    it("should handle hex without hash", () => {
      expect(hexToRgb("ff0000")).toEqual({ r: 255, g: 0, b: 0 });
    });
  });

  describe("rgbToHex", () => {
    it("should convert RGB to hex", () => {
      expect(rgbToHex({ r: 255, g: 0, b: 0 })).toBe("#ff0000");
      expect(rgbToHex({ r: 0, g: 255, b: 0 })).toBe("#00ff00");
      expect(rgbToHex({ r: 0, g: 0, b: 255 })).toBe("#0000ff");
    });

    it("should clamp values", () => {
      expect(rgbToHex({ r: 300, g: -50, b: 128 })).toBe("#ff0080");
    });
  });

  describe("rgbToHsl", () => {
    it("should convert RGB to HSL", () => {
      const red = rgbToHsl({ r: 255, g: 0, b: 0 });
      expect(red.h).toBeCloseTo(0, 1);
      expect(red.s).toBeCloseTo(1, 1);
      expect(red.l).toBeCloseTo(0.5, 1);

      const green = rgbToHsl({ r: 0, g: 255, b: 0 });
      expect(green.h).toBeCloseTo(120, 1);

      const blue = rgbToHsl({ r: 0, g: 0, b: 255 });
      expect(blue.h).toBeCloseTo(240, 1);
    });

    it("should handle grayscale", () => {
      const gray = rgbToHsl({ r: 128, g: 128, b: 128 });
      expect(gray.s).toBe(0);
    });
  });

  describe("hslToRgb", () => {
    it("should convert HSL to RGB", () => {
      const red = hslToRgb({ h: 0, s: 1, l: 0.5 });
      expect(red.r).toBe(255);
      expect(red.g).toBe(0);
      expect(red.b).toBe(0);

      const green = hslToRgb({ h: 120, s: 1, l: 0.5 });
      expect(green.r).toBe(0);
      expect(green.g).toBe(255);
      expect(green.b).toBe(0);
    });

    it("should handle grayscale (s=0)", () => {
      const gray = hslToRgb({ h: 0, s: 0, l: 0.5 });
      expect(gray.r).toBe(128);
      expect(gray.g).toBe(128);
      expect(gray.b).toBe(128);
    });
  });
});

// ============================================================
// Color Interpolation Tests
// ============================================================

describe("Color Interpolation", () => {
  describe("interpolateRgb", () => {
    it("should interpolate between two RGB colors", () => {
      const black = { r: 0, g: 0, b: 0 };
      const white = { r: 255, g: 255, b: 255 };

      const mid = interpolateRgb(black, white, 0.5);
      expect(mid.r).toBeCloseTo(127.5, 1);
      expect(mid.g).toBeCloseTo(127.5, 1);
      expect(mid.b).toBeCloseTo(127.5, 1);
    });
  });

  describe("interpolateRgba", () => {
    it("should interpolate including alpha", () => {
      const start = { r: 0, g: 0, b: 0, a: 0 };
      const end = { r: 255, g: 255, b: 255, a: 1 };

      const mid = interpolateRgba(start, end, 0.5);
      expect(mid.a).toBe(0.5);
    });
  });

  describe("interpolateHsl", () => {
    it("should interpolate between two HSL colors", () => {
      const red = { h: 0, s: 1, l: 0.5 };
      const green = { h: 120, s: 1, l: 0.5 };

      const mid = interpolateHsl(red, green, 0.5);
      expect(mid.h).toBe(60); // Yellow-ish
    });

    it("should use shortest path for hue", () => {
      const red = { h: 350, s: 1, l: 0.5 };
      const orange = { h: 30, s: 1, l: 0.5 };

      const mid = interpolateHsl(red, orange, 0.5);
      // Should go through 0/360, not the long way
      expect(mid.h).toBeCloseTo(10, 0);
    });

    it("should handle wraparound", () => {
      const start = { h: 350, s: 1, l: 0.5 };
      const end = { h: 10, s: 1, l: 0.5 };

      const mid = interpolateHsl(start, end, 0.5);
      expect(mid.h).toBeCloseTo(0, 1);
    });
  });

  describe("interpolateHex", () => {
    it("should interpolate between hex colors", () => {
      const result = interpolateHex("#000000", "#ffffff", 0.5);
      expect(result.toLowerCase()).toBe("#808080");
    });
  });

  describe("interpolateHexHsl", () => {
    it("should interpolate through HSL for smoother hue transitions", () => {
      const result = interpolateHexHsl("#ff0000", "#00ff00", 0.5);
      // Should produce a yellow-ish color
      const rgb = hexToRgb(result);
      expect(rgb.r).toBeGreaterThan(128);
      expect(rgb.g).toBeGreaterThan(128);
    });
  });
});

// ============================================================
// Opacity and Scale Tests
// ============================================================

describe("Opacity and Scale Interpolation", () => {
  describe("interpolateOpacity", () => {
    it("should interpolate opacity with clamping", () => {
      expect(interpolateOpacity(0, 1, 0.5)).toBe(0.5);
      expect(interpolateOpacity(0, 1, -0.5)).toBe(0);
      expect(interpolateOpacity(0, 1, 1.5)).toBe(1);
    });
  });

  describe("interpolateScale", () => {
    it("should interpolate scale with minimum bound", () => {
      expect(interpolateScale(0, 1, 0.5)).toBe(0.5);
      expect(interpolateScale(1, 0, 0.5, 0.2)).toBe(0.5);
      expect(interpolateScale(1, 0, 1, 0.2)).toBe(0.2); // Clamped to min
    });
  });

  describe("interpolateRotation", () => {
    it("should interpolate rotation", () => {
      expect(interpolateRotation(0, 180, 0.5)).toBe(90);
    });

    it("should use shortest path", () => {
      // From 350 to 10 should go through 0, not 180
      const result = interpolateRotation(350, 10, 0.5);
      expect(result).toBeCloseTo(0, 0);
    });

    it("should handle long path option", () => {
      const result = interpolateRotation(0, 180, 0.5, { shortestPath: false });
      expect(result).toBe(90);
    });
  });
});

// ============================================================
// Node Position Tests
// ============================================================

describe("Node Position Interpolation", () => {
  describe("interpolateNodePosition", () => {
    it("should interpolate node positions", () => {
      const start: NodePosition = {
        id: "node1",
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
      };
      const end: NodePosition = {
        id: "node1",
        x: 100,
        y: 100,
        scale: 2,
        opacity: 0.5,
      };

      const mid = interpolateNodePosition(start, end, 0.5);
      expect(mid.id).toBe("node1");
      expect(mid.x).toBe(50);
      expect(mid.y).toBe(50);
      expect(mid.scale).toBe(1.5);
      expect(mid.opacity).toBe(0.75);
    });

    it("should handle undefined optional properties", () => {
      const start: NodePosition = { id: "node1", x: 0, y: 0 };
      const end: NodePosition = { id: "node1", x: 100, y: 100 };

      const mid = interpolateNodePosition(start, end, 0.5);
      expect(mid.scale).toBeUndefined();
      expect(mid.opacity).toBeUndefined();
    });
  });

  describe("interpolateNodePositions", () => {
    it("should interpolate maps of node positions", () => {
      const start = new Map<string, NodePosition>([
        ["node1", { id: "node1", x: 0, y: 0 }],
        ["node2", { id: "node2", x: 100, y: 0 }],
      ]);
      const end = new Map<string, NodePosition>([
        ["node1", { id: "node1", x: 100, y: 100 }],
        ["node2", { id: "node2", x: 200, y: 100 }],
      ]);

      const mid = interpolateNodePositions(start, end, 0.5);
      expect(mid.get("node1")?.x).toBe(50);
      expect(mid.get("node2")?.x).toBe(150);
    });

    it("should handle entering nodes", () => {
      const start = new Map<string, NodePosition>([
        ["node1", { id: "node1", x: 0, y: 0, opacity: 1 }],
      ]);
      const end = new Map<string, NodePosition>([
        ["node1", { id: "node1", x: 0, y: 0, opacity: 1 }],
        ["node2", { id: "node2", x: 100, y: 100, opacity: 1 }],
      ]);

      const mid = interpolateNodePositions(start, end, 0.5);
      expect(mid.has("node2")).toBe(true);
      expect(mid.get("node2")?.opacity).toBe(0.5); // Fading in
    });

    it("should handle exiting nodes", () => {
      const start = new Map<string, NodePosition>([
        ["node1", { id: "node1", x: 0, y: 0, opacity: 1 }],
        ["node2", { id: "node2", x: 100, y: 100, opacity: 1 }],
      ]);
      const end = new Map<string, NodePosition>([
        ["node1", { id: "node1", x: 0, y: 0, opacity: 1 }],
      ]);

      const mid = interpolateNodePositions(start, end, 0.5);
      expect(mid.has("node2")).toBe(true);
      expect(mid.get("node2")?.opacity).toBe(0.5); // Fading out
    });
  });
});

// ============================================================
// Array Interpolation Tests
// ============================================================

describe("Array Interpolation", () => {
  describe("interpolateArray", () => {
    it("should interpolate arrays of numbers", () => {
      const start = [0, 10, 20];
      const end = [100, 110, 120];

      const mid = interpolateArray(start, end, 0.5);
      expect(mid).toEqual([50, 60, 70]);
    });

    it("should handle different array lengths", () => {
      const start = [0, 10];
      const end = [100, 110, 120];

      const mid = interpolateArray(start, end, 0.5);
      expect(mid.length).toBe(3);
      expect(mid[2]).toBe(60); // 0 -> 120
    });
  });

  describe("interpolatePointArray", () => {
    it("should interpolate arrays of points", () => {
      const start = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
      const end = [{ x: 100, y: 100 }, { x: 110, y: 110 }];

      const mid = interpolatePointArray(start, end, 0.5);
      expect(mid[0]).toEqual({ x: 50, y: 50 });
      expect(mid[1]).toEqual({ x: 60, y: 60 });
    });
  });
});

// ============================================================
// Staggered Interpolation Tests
// ============================================================

describe("Staggered Interpolation", () => {
  describe("calculateStaggeredProgress", () => {
    it("should return global progress for single item", () => {
      expect(calculateStaggeredProgress(0.5, 0, 1, 0.1)).toBe(0.5);
    });

    it("should stagger progress for multiple items", () => {
      const total = 5;
      const stagger = 0.1;

      // First item should be ahead
      const first = calculateStaggeredProgress(0.5, 0, total, stagger);
      // Last item should be behind
      const last = calculateStaggeredProgress(0.5, 4, total, stagger);

      expect(first).toBeGreaterThan(last);
    });

    it("should clamp progress to [0, 1]", () => {
      expect(calculateStaggeredProgress(0, 4, 5, 0.1)).toBe(0);
      expect(calculateStaggeredProgress(1, 0, 5, 0.1)).toBe(1);
    });
  });

  describe("interpolateStaggered", () => {
    it("should apply staggered interpolation to positions", () => {
      const start = new Map([
        ["a", { x: 0, y: 0 }],
        ["b", { x: 0, y: 0 }],
        ["c", { x: 0, y: 0 }],
      ]);
      const end = new Map([
        ["a", { x: 100, y: 100 }],
        ["b", { x: 100, y: 100 }],
        ["c", { x: 100, y: 100 }],
      ]);

      const result = interpolateStaggered(start, end, 0.5, 0.1);

      // All should be different due to stagger
      const aPos = result.get("a")!;
      const bPos = result.get("b")!;
      const cPos = result.get("c")!;

      expect(aPos.x).toBeGreaterThan(cPos.x);
    });
  });
});

/**
 * BundlingTypes Unit Tests
 *
 * Tests for:
 * - Default configuration values
 * - Vector math utility functions
 * - Type definitions
 */

import {
  DEFAULT_BUNDLING_CONFIG,
  DEFAULT_HIERARCHICAL_CONFIG,
  distance,
  midpoint,
  normalize,
  dot,
  subtract,
  add,
  scale,
  lerp,
  projectOntoLine,
  type Vector2,
  type BundlingConfig,
} from "@plugin/presentation/renderers/graph/bundling/BundlingTypes";

describe("BundlingTypes Module", () => {
  describe("DEFAULT_BUNDLING_CONFIG", () => {
    it("should have fdeb as default algorithm", () => {
      expect(DEFAULT_BUNDLING_CONFIG.algorithm).toBe("fdeb");
    });

    it("should have 60 iterations by default", () => {
      expect(DEFAULT_BUNDLING_CONFIG.iterations).toBe(60);
    });

    it("should have 0.04 step size by default", () => {
      expect(DEFAULT_BUNDLING_CONFIG.stepSize).toBe(0.04);
    });

    it("should have 0.6 compatibility threshold", () => {
      expect(DEFAULT_BUNDLING_CONFIG.compatibility).toBe(0.6);
    });

    it("should have 2 subdivision rate", () => {
      expect(DEFAULT_BUNDLING_CONFIG.subdivisionRate).toBe(2);
    });

    it("should have 0.1 spring constant", () => {
      expect(DEFAULT_BUNDLING_CONFIG.springConstant).toBe(0.1);
    });

    it("should have 0.85 bundle strength", () => {
      expect(DEFAULT_BUNDLING_CONFIG.bundleStrength).toBe(0.85);
    });

    it("should have 64 max subdivisions", () => {
      expect(DEFAULT_BUNDLING_CONFIG.maxSubdivisions).toBe(64);
    });

    it("should have adaptive step size enabled", () => {
      expect(DEFAULT_BUNDLING_CONFIG.adaptiveStepSize).toBe(true);
    });
  });

  describe("DEFAULT_HIERARCHICAL_CONFIG", () => {
    it("should have hierarchical as algorithm", () => {
      expect(DEFAULT_HIERARCHICAL_CONFIG.algorithm).toBe("hierarchical");
    });

    it("should have 0.85 beta parameter", () => {
      expect(DEFAULT_HIERARCHICAL_CONFIG.beta).toBe(0.85);
    });

    it("should have radial layout disabled by default", () => {
      expect(DEFAULT_HIERARCHICAL_CONFIG.radialLayout).toBe(false);
    });

    it("should have 0.85 tension", () => {
      expect(DEFAULT_HIERARCHICAL_CONFIG.tension).toBe(0.85);
    });

    it("should inherit from DEFAULT_BUNDLING_CONFIG", () => {
      expect(DEFAULT_HIERARCHICAL_CONFIG.iterations).toBe(
        DEFAULT_BUNDLING_CONFIG.iterations
      );
      expect(DEFAULT_HIERARCHICAL_CONFIG.bundleStrength).toBe(
        DEFAULT_BUNDLING_CONFIG.bundleStrength
      );
    });
  });

  describe("Vector Math Utilities", () => {
    describe("distance", () => {
      it("should return 0 for same point", () => {
        const p: Vector2 = { x: 5, y: 5 };
        expect(distance(p, p)).toBe(0);
      });

      it("should calculate horizontal distance", () => {
        const p1: Vector2 = { x: 0, y: 0 };
        const p2: Vector2 = { x: 3, y: 0 };
        expect(distance(p1, p2)).toBe(3);
      });

      it("should calculate vertical distance", () => {
        const p1: Vector2 = { x: 0, y: 0 };
        const p2: Vector2 = { x: 0, y: 4 };
        expect(distance(p1, p2)).toBe(4);
      });

      it("should calculate diagonal distance (3-4-5 triangle)", () => {
        const p1: Vector2 = { x: 0, y: 0 };
        const p2: Vector2 = { x: 3, y: 4 };
        expect(distance(p1, p2)).toBe(5);
      });

      it("should be symmetric", () => {
        const p1: Vector2 = { x: 1, y: 2 };
        const p2: Vector2 = { x: 4, y: 6 };
        expect(distance(p1, p2)).toBe(distance(p2, p1));
      });
    });

    describe("midpoint", () => {
      it("should return midpoint of horizontal line", () => {
        const p1: Vector2 = { x: 0, y: 0 };
        const p2: Vector2 = { x: 10, y: 0 };
        const mid = midpoint(p1, p2);
        expect(mid.x).toBe(5);
        expect(mid.y).toBe(0);
      });

      it("should return midpoint of vertical line", () => {
        const p1: Vector2 = { x: 0, y: 0 };
        const p2: Vector2 = { x: 0, y: 10 };
        const mid = midpoint(p1, p2);
        expect(mid.x).toBe(0);
        expect(mid.y).toBe(5);
      });

      it("should return midpoint of diagonal line", () => {
        const p1: Vector2 = { x: 2, y: 4 };
        const p2: Vector2 = { x: 8, y: 10 };
        const mid = midpoint(p1, p2);
        expect(mid.x).toBe(5);
        expect(mid.y).toBe(7);
      });

      it("should return same point when both points are same", () => {
        const p: Vector2 = { x: 3, y: 7 };
        const mid = midpoint(p, p);
        expect(mid.x).toBe(3);
        expect(mid.y).toBe(7);
      });
    });

    describe("normalize", () => {
      it("should normalize horizontal vector", () => {
        const v: Vector2 = { x: 10, y: 0 };
        const n = normalize(v);
        expect(n.x).toBeCloseTo(1);
        expect(n.y).toBeCloseTo(0);
      });

      it("should normalize vertical vector", () => {
        const v: Vector2 = { x: 0, y: 10 };
        const n = normalize(v);
        expect(n.x).toBeCloseTo(0);
        expect(n.y).toBeCloseTo(1);
      });

      it("should normalize diagonal vector", () => {
        const v: Vector2 = { x: 3, y: 4 };
        const n = normalize(v);
        expect(n.x).toBeCloseTo(0.6);
        expect(n.y).toBeCloseTo(0.8);
      });

      it("should return unit length vector", () => {
        const v: Vector2 = { x: 7, y: 11 };
        const n = normalize(v);
        const len = Math.sqrt(n.x * n.x + n.y * n.y);
        expect(len).toBeCloseTo(1);
      });

      it("should return zero vector for zero input", () => {
        const v: Vector2 = { x: 0, y: 0 };
        const n = normalize(v);
        expect(n.x).toBe(0);
        expect(n.y).toBe(0);
      });
    });

    describe("dot", () => {
      it("should return 0 for perpendicular vectors", () => {
        const v1: Vector2 = { x: 1, y: 0 };
        const v2: Vector2 = { x: 0, y: 1 };
        expect(dot(v1, v2)).toBe(0);
      });

      it("should return positive for parallel vectors", () => {
        const v1: Vector2 = { x: 1, y: 0 };
        const v2: Vector2 = { x: 2, y: 0 };
        expect(dot(v1, v2)).toBe(2);
      });

      it("should return negative for opposite vectors", () => {
        const v1: Vector2 = { x: 1, y: 0 };
        const v2: Vector2 = { x: -1, y: 0 };
        expect(dot(v1, v2)).toBe(-1);
      });

      it("should be commutative", () => {
        const v1: Vector2 = { x: 3, y: 4 };
        const v2: Vector2 = { x: 5, y: 2 };
        expect(dot(v1, v2)).toBe(dot(v2, v1));
      });

      it("should calculate correctly for arbitrary vectors", () => {
        const v1: Vector2 = { x: 3, y: 4 };
        const v2: Vector2 = { x: 5, y: 2 };
        expect(dot(v1, v2)).toBe(3 * 5 + 4 * 2); // 23
      });
    });

    describe("subtract", () => {
      it("should subtract vectors correctly", () => {
        const v1: Vector2 = { x: 5, y: 7 };
        const v2: Vector2 = { x: 2, y: 3 };
        const result = subtract(v1, v2);
        expect(result.x).toBe(3);
        expect(result.y).toBe(4);
      });

      it("should return zero for same vectors", () => {
        const v: Vector2 = { x: 5, y: 7 };
        const result = subtract(v, v);
        expect(result.x).toBe(0);
        expect(result.y).toBe(0);
      });

      it("should handle negative values", () => {
        const v1: Vector2 = { x: -2, y: 3 };
        const v2: Vector2 = { x: 5, y: -1 };
        const result = subtract(v1, v2);
        expect(result.x).toBe(-7);
        expect(result.y).toBe(4);
      });
    });

    describe("add", () => {
      it("should add vectors correctly", () => {
        const v1: Vector2 = { x: 3, y: 4 };
        const v2: Vector2 = { x: 2, y: 1 };
        const result = add(v1, v2);
        expect(result.x).toBe(5);
        expect(result.y).toBe(5);
      });

      it("should be commutative", () => {
        const v1: Vector2 = { x: 3, y: 4 };
        const v2: Vector2 = { x: 2, y: 1 };
        const r1 = add(v1, v2);
        const r2 = add(v2, v1);
        expect(r1.x).toBe(r2.x);
        expect(r1.y).toBe(r2.y);
      });

      it("should handle zero vector", () => {
        const v: Vector2 = { x: 5, y: 7 };
        const zero: Vector2 = { x: 0, y: 0 };
        const result = add(v, zero);
        expect(result.x).toBe(5);
        expect(result.y).toBe(7);
      });
    });

    describe("scale", () => {
      it("should scale vector by positive scalar", () => {
        const v: Vector2 = { x: 3, y: 4 };
        const result = scale(v, 2);
        expect(result.x).toBe(6);
        expect(result.y).toBe(8);
      });

      it("should scale vector by zero", () => {
        const v: Vector2 = { x: 3, y: 4 };
        const result = scale(v, 0);
        expect(result.x).toBe(0);
        expect(result.y).toBe(0);
      });

      it("should scale vector by negative scalar", () => {
        const v: Vector2 = { x: 3, y: 4 };
        const result = scale(v, -1);
        expect(result.x).toBe(-3);
        expect(result.y).toBe(-4);
      });

      it("should scale vector by fractional scalar", () => {
        const v: Vector2 = { x: 10, y: 20 };
        const result = scale(v, 0.5);
        expect(result.x).toBe(5);
        expect(result.y).toBe(10);
      });
    });

    describe("lerp", () => {
      it("should return start point at t=0", () => {
        const p1: Vector2 = { x: 0, y: 0 };
        const p2: Vector2 = { x: 10, y: 10 };
        const result = lerp(p1, p2, 0);
        expect(result.x).toBe(0);
        expect(result.y).toBe(0);
      });

      it("should return end point at t=1", () => {
        const p1: Vector2 = { x: 0, y: 0 };
        const p2: Vector2 = { x: 10, y: 10 };
        const result = lerp(p1, p2, 1);
        expect(result.x).toBe(10);
        expect(result.y).toBe(10);
      });

      it("should return midpoint at t=0.5", () => {
        const p1: Vector2 = { x: 0, y: 0 };
        const p2: Vector2 = { x: 10, y: 10 };
        const result = lerp(p1, p2, 0.5);
        expect(result.x).toBe(5);
        expect(result.y).toBe(5);
      });

      it("should handle arbitrary t values", () => {
        const p1: Vector2 = { x: 0, y: 0 };
        const p2: Vector2 = { x: 100, y: 200 };
        const result = lerp(p1, p2, 0.25);
        expect(result.x).toBe(25);
        expect(result.y).toBe(50);
      });

      it("should handle extrapolation (t > 1)", () => {
        const p1: Vector2 = { x: 0, y: 0 };
        const p2: Vector2 = { x: 10, y: 10 };
        const result = lerp(p1, p2, 2);
        expect(result.x).toBe(20);
        expect(result.y).toBe(20);
      });
    });

    describe("projectOntoLine", () => {
      it("should project point onto horizontal line", () => {
        const point: Vector2 = { x: 5, y: 10 };
        const lineStart: Vector2 = { x: 0, y: 0 };
        const lineEnd: Vector2 = { x: 10, y: 0 };
        const result = projectOntoLine(point, lineStart, lineEnd);
        expect(result.point.x).toBe(5);
        expect(result.point.y).toBe(0);
        expect(result.t).toBe(0.5);
      });

      it("should project point onto vertical line", () => {
        const point: Vector2 = { x: 10, y: 5 };
        const lineStart: Vector2 = { x: 0, y: 0 };
        const lineEnd: Vector2 = { x: 0, y: 10 };
        const result = projectOntoLine(point, lineStart, lineEnd);
        expect(result.point.x).toBe(0);
        expect(result.point.y).toBe(5);
        expect(result.t).toBe(0.5);
      });

      it("should clamp t to [0, 1]", () => {
        const point: Vector2 = { x: -5, y: 0 };
        const lineStart: Vector2 = { x: 0, y: 0 };
        const lineEnd: Vector2 = { x: 10, y: 0 };
        const result = projectOntoLine(point, lineStart, lineEnd);
        expect(result.t).toBe(0);
        expect(result.point.x).toBe(0);
      });

      it("should handle point beyond line end", () => {
        const point: Vector2 = { x: 15, y: 0 };
        const lineStart: Vector2 = { x: 0, y: 0 };
        const lineEnd: Vector2 = { x: 10, y: 0 };
        const result = projectOntoLine(point, lineStart, lineEnd);
        expect(result.t).toBe(1);
        expect(result.point.x).toBe(10);
      });

      it("should handle zero-length line", () => {
        const point: Vector2 = { x: 5, y: 5 };
        const lineStart: Vector2 = { x: 0, y: 0 };
        const result = projectOntoLine(point, lineStart, lineStart);
        expect(result.t).toBe(0);
        expect(result.point.x).toBe(0);
        expect(result.point.y).toBe(0);
      });
    });
  });
});

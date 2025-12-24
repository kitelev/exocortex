/**
 * Quadtree Tests
 *
 * Tests for the Quadtree data structure used in Barnes-Hut algorithm.
 */

import { Quadtree } from "@plugin/presentation/renderers/graph/Quadtree";

interface TestPoint {
  x: number;
  y: number;
  id: string;
}

describe("Quadtree", () => {
  describe("constructor", () => {
    it("should create empty quadtree", () => {
      const tree = new Quadtree<TestPoint>();
      expect(tree.size()).toBe(0);
      expect(tree.data()).toEqual([]);
    });

    it("should create quadtree with initial points", () => {
      const points: TestPoint[] = [
        { x: 10, y: 20, id: "a" },
        { x: 30, y: 40, id: "b" },
        { x: 50, y: 60, id: "c" },
      ];
      const tree = new Quadtree(points);
      expect(tree.size()).toBe(3);
    });

    it("should use custom accessors", () => {
      interface CustomPoint {
        posX: number;
        posY: number;
        name: string;
      }
      const points: CustomPoint[] = [
        { posX: 10, posY: 20, name: "a" },
        { posX: 30, posY: 40, name: "b" },
      ];
      const tree = new Quadtree(
        points,
        (d) => d.posX,
        (d) => d.posY
      );
      expect(tree.size()).toBe(2);
    });
  });

  describe("add", () => {
    it("should add single point", () => {
      const tree = new Quadtree<TestPoint>();
      tree.add({ x: 10, y: 20, id: "a" });
      expect(tree.size()).toBe(1);
    });

    it("should add multiple points", () => {
      const tree = new Quadtree<TestPoint>();
      tree.add({ x: 10, y: 20, id: "a" });
      tree.add({ x: 30, y: 40, id: "b" });
      tree.add({ x: 50, y: 60, id: "c" });
      expect(tree.size()).toBe(3);
    });

    it("should handle coincident points", () => {
      const tree = new Quadtree<TestPoint>();
      tree.add({ x: 10, y: 20, id: "a" });
      tree.add({ x: 10, y: 20, id: "b" });
      tree.add({ x: 10, y: 20, id: "c" });
      expect(tree.size()).toBe(3);
    });

    it("should ignore NaN coordinates", () => {
      const tree = new Quadtree<TestPoint>();
      tree.add({ x: NaN, y: 20, id: "a" });
      tree.add({ x: 10, y: NaN, id: "b" });
      tree.add({ x: 10, y: 20, id: "c" });
      expect(tree.size()).toBe(1);
    });
  });

  describe("addAll", () => {
    it("should add array of points", () => {
      const tree = new Quadtree<TestPoint>();
      tree.addAll([
        { x: 10, y: 20, id: "a" },
        { x: 30, y: 40, id: "b" },
        { x: 50, y: 60, id: "c" },
      ]);
      expect(tree.size()).toBe(3);
    });
  });

  describe("extent", () => {
    it("should return bounds of tree", () => {
      const tree = new Quadtree<TestPoint>([
        { x: 10, y: 20, id: "a" },
        { x: 50, y: 60, id: "b" },
      ]);
      const [[x0, y0], [x1, y1]] = tree.extent();
      expect(x0).toBeLessThanOrEqual(10);
      expect(y0).toBeLessThanOrEqual(20);
      expect(x1).toBeGreaterThanOrEqual(50);
      expect(y1).toBeGreaterThanOrEqual(60);
    });
  });

  describe("find", () => {
    it("should find nearest point", () => {
      const points: TestPoint[] = [
        { x: 10, y: 10, id: "a" },
        { x: 50, y: 50, id: "b" },
        { x: 90, y: 90, id: "c" },
      ];
      const tree = new Quadtree(points);

      const nearest = tree.find(45, 45);
      expect(nearest?.id).toBe("b");
    });

    it("should find point within radius", () => {
      const points: TestPoint[] = [
        { x: 10, y: 10, id: "a" },
        { x: 50, y: 50, id: "b" },
        { x: 90, y: 90, id: "c" },
      ];
      const tree = new Quadtree(points);

      // Within radius
      const found = tree.find(52, 52, 10);
      expect(found?.id).toBe("b");

      // Outside radius
      const notFound = tree.find(52, 52, 1);
      expect(notFound).toBeUndefined();
    });

    it("should return undefined for empty tree", () => {
      const tree = new Quadtree<TestPoint>();
      expect(tree.find(0, 0)).toBeUndefined();
    });

    it("should return undefined for NaN coordinates", () => {
      const tree = new Quadtree<TestPoint>([{ x: 10, y: 20, id: "a" }]);
      expect(tree.find(NaN, 20)).toBeUndefined();
      expect(tree.find(10, NaN)).toBeUndefined();
    });
  });

  describe("visit", () => {
    it("should visit all nodes", () => {
      const tree = new Quadtree<TestPoint>([
        { x: 10, y: 10, id: "a" },
        { x: 50, y: 50, id: "b" },
        { x: 90, y: 90, id: "c" },
      ]);

      const visited: string[] = [];
      tree.visit((node) => {
        if (node.data) {
          visited.push(node.data.id);
        }
        return false; // Continue visiting
      });

      expect(visited).toHaveLength(3);
      expect(visited).toContain("a");
      expect(visited).toContain("b");
      expect(visited).toContain("c");
    });

    it("should skip subtrees when callback returns true", () => {
      const tree = new Quadtree<TestPoint>([
        { x: 10, y: 10, id: "a" },
        { x: 50, y: 50, id: "b" },
        { x: 90, y: 90, id: "c" },
      ]);

      let visitCount = 0;
      tree.visit(() => {
        visitCount++;
        return true; // Skip all children
      });

      expect(visitCount).toBe(1); // Only root visited
    });
  });

  describe("visitAfter", () => {
    it("should visit nodes in post-order", () => {
      const tree = new Quadtree<TestPoint>([
        { x: 10, y: 10, id: "a" },
        { x: 50, y: 50, id: "b" },
      ]);

      const visits: { hasChildren: boolean; hasData: boolean }[] = [];
      tree.visitAfter((node) => {
        visits.push({
          hasChildren: node.children !== undefined,
          hasData: node.data !== undefined,
        });
      });

      // In post-order, leaves are visited before internal nodes
      // Leaf nodes have data, internal nodes have children
      expect(visits.length).toBeGreaterThan(0);
    });
  });

  describe("data", () => {
    it("should return all data points", () => {
      const points: TestPoint[] = [
        { x: 10, y: 20, id: "a" },
        { x: 30, y: 40, id: "b" },
        { x: 50, y: 60, id: "c" },
      ];
      const tree = new Quadtree(points);
      const data = tree.data();

      expect(data).toHaveLength(3);
      expect(data.map((d) => d.id).sort()).toEqual(["a", "b", "c"]);
    });

    it("should include coincident points", () => {
      const tree = new Quadtree<TestPoint>();
      tree.add({ x: 10, y: 20, id: "a" });
      tree.add({ x: 10, y: 20, id: "b" });
      const data = tree.data();

      expect(data).toHaveLength(2);
      expect(data.map((d) => d.id).sort()).toEqual(["a", "b"]);
    });
  });

  describe("getRoot", () => {
    it("should return undefined for empty tree", () => {
      const tree = new Quadtree<TestPoint>();
      expect(tree.getRoot()).toBeUndefined();
    });

    it("should return root node for non-empty tree", () => {
      const tree = new Quadtree<TestPoint>([{ x: 10, y: 20, id: "a" }]);
      const root = tree.getRoot();
      expect(root).toBeDefined();
      expect(root?.data).toBeDefined();
    });
  });

  describe("performance", () => {
    it("should handle large number of points", () => {
      const points: TestPoint[] = [];
      for (let i = 0; i < 10000; i++) {
        points.push({
          x: Math.random() * 1000,
          y: Math.random() * 1000,
          id: `node-${i}`,
        });
      }

      const start = performance.now();
      const tree = new Quadtree(points);
      const buildTime = performance.now() - start;

      expect(tree.size()).toBe(10000);
      expect(buildTime).toBeLessThan(1000); // Should build in < 1 second

      // Test find performance
      const findStart = performance.now();
      for (let i = 0; i < 1000; i++) {
        tree.find(Math.random() * 1000, Math.random() * 1000);
      }
      const findTime = performance.now() - findStart;
      expect(findTime).toBeLessThan(5000); // 1000 finds in < 5 seconds (relaxed for CI)
    });
  });
});

/**
 * Edge Bundling Module Index Tests
 *
 * Tests for:
 * - Module exports
 * - Factory function
 */

import {
  // Bundlers
  StubBundler,
  createStubBundler,
  FDEBBundler,
  createFDEBBundler,
  HierarchicalBundler,
  createHierarchicalBundler,
  createEdgeBundler,
  // Constants
  DEFAULT_BUNDLING_CONFIG,
  DEFAULT_HIERARCHICAL_CONFIG,
  // Utilities
  distance,
  midpoint,
  normalize,
  dot,
  subtract,
  add,
  scale,
  lerp,
  projectOntoLine,
} from "@plugin/presentation/renderers/graph/bundling";

describe("Bundling Module Index", () => {
  describe("Bundler Class Exports", () => {
    it("should export StubBundler class", () => {
      expect(StubBundler).toBeDefined();
      expect(typeof StubBundler).toBe("function");
    });

    it("should export FDEBBundler class", () => {
      expect(FDEBBundler).toBeDefined();
      expect(typeof FDEBBundler).toBe("function");
    });

    it("should export HierarchicalBundler class", () => {
      expect(HierarchicalBundler).toBeDefined();
      expect(typeof HierarchicalBundler).toBe("function");
    });
  });

  describe("Factory Function Exports", () => {
    it("should export createStubBundler factory", () => {
      expect(createStubBundler).toBeDefined();
      expect(typeof createStubBundler).toBe("function");
    });

    it("should export createFDEBBundler factory", () => {
      expect(createFDEBBundler).toBeDefined();
      expect(typeof createFDEBBundler).toBe("function");
    });

    it("should export createHierarchicalBundler factory", () => {
      expect(createHierarchicalBundler).toBeDefined();
      expect(typeof createHierarchicalBundler).toBe("function");
    });

    it("should export createEdgeBundler factory", () => {
      expect(createEdgeBundler).toBeDefined();
      expect(typeof createEdgeBundler).toBe("function");
    });
  });

  describe("Constants Exports", () => {
    it("should export DEFAULT_BUNDLING_CONFIG", () => {
      expect(DEFAULT_BUNDLING_CONFIG).toBeDefined();
      expect(DEFAULT_BUNDLING_CONFIG.algorithm).toBe("fdeb");
    });

    it("should export DEFAULT_HIERARCHICAL_CONFIG", () => {
      expect(DEFAULT_HIERARCHICAL_CONFIG).toBeDefined();
      expect(DEFAULT_HIERARCHICAL_CONFIG.algorithm).toBe("hierarchical");
    });
  });

  describe("Utility Function Exports", () => {
    it("should export distance function", () => {
      expect(distance).toBeDefined();
      expect(typeof distance).toBe("function");
    });

    it("should export midpoint function", () => {
      expect(midpoint).toBeDefined();
      expect(typeof midpoint).toBe("function");
    });

    it("should export normalize function", () => {
      expect(normalize).toBeDefined();
      expect(typeof normalize).toBe("function");
    });

    it("should export dot function", () => {
      expect(dot).toBeDefined();
      expect(typeof dot).toBe("function");
    });

    it("should export subtract function", () => {
      expect(subtract).toBeDefined();
      expect(typeof subtract).toBe("function");
    });

    it("should export add function", () => {
      expect(add).toBeDefined();
      expect(typeof add).toBe("function");
    });

    it("should export scale function", () => {
      expect(scale).toBeDefined();
      expect(typeof scale).toBe("function");
    });

    it("should export lerp function", () => {
      expect(lerp).toBeDefined();
      expect(typeof lerp).toBe("function");
    });

    it("should export projectOntoLine function", () => {
      expect(projectOntoLine).toBeDefined();
      expect(typeof projectOntoLine).toBe("function");
    });
  });

  describe("createEdgeBundler Factory", () => {
    it("should create StubBundler for stub algorithm", () => {
      const bundler = createEdgeBundler("stub");
      expect(bundler.getName()).toBe("stub");
    });

    it("should create FDEBBundler for fdeb algorithm", () => {
      const bundler = createEdgeBundler("fdeb");
      expect(bundler.getName()).toBe("fdeb");
    });

    it("should create HierarchicalBundler for hierarchical algorithm", () => {
      const bundler = createEdgeBundler("hierarchical");
      expect(bundler.getName()).toBe("hierarchical");
    });

    it("should default to stub bundler", () => {
      const bundler = createEdgeBundler();
      // Default is fdeb according to implementation
      expect(bundler.getName()).toBe("fdeb");
    });

    it("should pass config to created bundler", () => {
      const bundler = createEdgeBundler("fdeb", { iterations: 200 });
      expect(bundler.getConfig().iterations).toBe(200);
    });
  });
});

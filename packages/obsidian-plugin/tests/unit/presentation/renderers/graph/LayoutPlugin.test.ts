/**
 * LayoutPlugin Tests
 *
 * Tests for the layout plugin architecture including:
 * - BaseLayoutAlgorithm class
 * - LayoutPluginRegistry
 * - Factory functions
 * - Option validation
 */

import {
  BaseLayoutAlgorithm,
  LayoutPluginRegistry,
  createLayoutFactory,
  createLayoutPlugin,
  createBuiltInLayoutPlugin,
  layoutPluginRegistry,
  type LayoutPlugin,
  type LayoutPluginMetadata,
  type LayoutOptionDefinition,
  type LayoutResult,
  type ValidationResult,
  type PluginRegistryEvent,
  type PluginFilter,
  type LayoutAlgorithmInstance,
} from "../../../../../src/presentation/renderers/graph/LayoutPlugin";
import type { GraphData } from "../../../../../src/presentation/renderers/graph/types";
import type { Point } from "../../../../../src/presentation/renderers/graph/LayoutManager";

// ============================================================
// Test Utilities
// ============================================================

/**
 * Create a simple test graph
 */
function createTestGraph(nodeCount: number = 5): GraphData {
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      id: `node-${i}`,
      label: `Node ${i}`,
      path: `/path/to/node-${i}.md`,
    });
  }

  const edges = [];
  for (let i = 1; i < nodeCount; i++) {
    edges.push({
      id: `edge-${i - 1}-${i}`,
      source: `node-${i - 1}`,
      target: `node-${i}`,
    });
  }

  return { nodes, edges };
}

/**
 * Create a tree graph
 */
function createTreeGraph(): GraphData {
  return {
    nodes: [
      { id: "root", label: "Root", path: "/root.md" },
      { id: "child1", label: "Child 1", path: "/child1.md" },
      { id: "child2", label: "Child 2", path: "/child2.md" },
      { id: "grandchild1", label: "Grandchild 1", path: "/grandchild1.md" },
      { id: "grandchild2", label: "Grandchild 2", path: "/grandchild2.md" },
    ],
    edges: [
      { id: "e1", source: "root", target: "child1" },
      { id: "e2", source: "root", target: "child2" },
      { id: "e3", source: "child1", target: "grandchild1" },
      { id: "e4", source: "child1", target: "grandchild2" },
    ],
  };
}

/**
 * Create a graph with cycles
 */
function createCyclicGraph(): GraphData {
  return {
    nodes: [
      { id: "a", label: "A", path: "/a.md" },
      { id: "b", label: "B", path: "/b.md" },
      { id: "c", label: "C", path: "/c.md" },
    ],
    edges: [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "b", target: "c" },
      { id: "e3", source: "c", target: "a" },
    ],
  };
}

/**
 * Simple test layout implementation
 */
class TestLayout extends BaseLayoutAlgorithm {
  static readonly OPTION_DEFINITIONS: LayoutOptionDefinition[] = [
    { name: "spacing", type: "number", label: "Spacing", default: 50, min: 10, max: 200 },
    { name: "horizontal", type: "boolean", label: "Horizontal", default: false },
    { name: "direction", type: "select", label: "Direction", default: "lr", options: [
      { value: "lr", label: "Left to Right" },
      { value: "rl", label: "Right to Left" },
      { value: "tb", label: "Top to Bottom" },
    ]},
  ];

  constructor(options?: Record<string, unknown>) {
    super("test-layout", options);
  }

  getDefaults(): Record<string, unknown> {
    return {
      spacing: 50,
      horizontal: false,
      direction: "lr",
    };
  }

  layout(graph: GraphData): LayoutResult {
    const positions = new Map<string, Point>();
    const spacing = this.options.spacing as number;
    const horizontal = this.options.horizontal as boolean;

    graph.nodes.forEach((node, index) => {
      if (horizontal) {
        positions.set(node.id, { x: index * spacing, y: 0 });
      } else {
        positions.set(node.id, { x: 0, y: index * spacing });
      }
    });

    return {
      positions,
      bounds: this.calculateBounds(positions),
    };
  }
}

/**
 * Create a test plugin
 */
function createTestPlugin(id: string = "test-plugin"): LayoutPlugin {
  return createLayoutPlugin(
    TestLayout,
    {
      id,
      name: "Test Layout",
      description: "A test layout algorithm",
      version: "1.0.0",
      category: "domain-specific",
      tags: ["test", "ontology"],
      supportedGraphTypes: ["dag", "tree"],
    },
    TestLayout.OPTION_DEFINITIONS
  );
}

// ============================================================
// BaseLayoutAlgorithm Tests
// ============================================================

describe("BaseLayoutAlgorithm", () => {
  describe("constructor", () => {
    it("should create with default options", () => {
      const layout = new TestLayout();

      expect(layout.name).toBe("test-layout");
      expect(layout.getOptions()).toEqual({
        spacing: 50,
        horizontal: false,
        direction: "lr",
      });
    });

    it("should merge custom options with defaults", () => {
      const layout = new TestLayout({ spacing: 100 });

      expect(layout.getOptions()).toEqual({
        spacing: 100,
        horizontal: false,
        direction: "lr",
      });
    });
  });

  describe("getOptions / setOptions", () => {
    it("should return current options", () => {
      const layout = new TestLayout();
      const options = layout.getOptions();

      expect(options.spacing).toBe(50);
    });

    it("should set options", () => {
      const layout = new TestLayout();
      layout.setOptions({ spacing: 75 });

      expect(layout.getOptions().spacing).toBe(75);
    });

    it("should merge with existing options", () => {
      const layout = new TestLayout({ spacing: 100 });
      layout.setOptions({ horizontal: true });

      expect(layout.getOptions()).toEqual({
        spacing: 100,
        horizontal: true,
        direction: "lr",
      });
    });
  });

  describe("layout", () => {
    it("should compute layout positions", () => {
      const layout = new TestLayout();
      const graph = createTestGraph(3);

      const result = layout.layout(graph);

      expect(result.positions.size).toBe(3);
      expect(result.positions.has("node-0")).toBe(true);
      expect(result.positions.has("node-1")).toBe(true);
      expect(result.positions.has("node-2")).toBe(true);
    });

    it("should respect options", () => {
      const layout = new TestLayout({ horizontal: true, spacing: 100 });
      const graph = createTestGraph(3);

      const result = layout.layout(graph);

      // Horizontal layout: nodes should be spread on x-axis
      expect(result.positions.get("node-0")).toEqual({ x: 0, y: 0 });
      expect(result.positions.get("node-1")).toEqual({ x: 100, y: 0 });
      expect(result.positions.get("node-2")).toEqual({ x: 200, y: 0 });
    });

    it("should calculate correct bounds", () => {
      const layout = new TestLayout({ horizontal: true, spacing: 100 });
      const graph = createTestGraph(3);

      const result = layout.layout(graph);

      expect(result.bounds.minX).toBe(0);
      expect(result.bounds.minY).toBe(0);
      expect(result.bounds.maxX).toBe(200);
      expect(result.bounds.maxY).toBe(0);
      expect(result.bounds.width).toBe(200);
      expect(result.bounds.height).toBe(0);
    });
  });

  describe("canLayout", () => {
    it("should return true for non-empty graph", () => {
      const layout = new TestLayout();
      const graph = createTestGraph(3);

      expect(layout.canLayout(graph)).toBe(true);
    });

    it("should return false for empty graph", () => {
      const layout = new TestLayout();
      const graph: GraphData = { nodes: [], edges: [] };

      expect(layout.canLayout(graph)).toBe(false);
    });
  });

  describe("estimateComplexity", () => {
    it("should return low complexity for small graphs", () => {
      const layout = new TestLayout();
      const graph = createTestGraph(10);

      const complexity = layout.estimateComplexity(graph);
      expect(complexity).toBeLessThan(0.1);
    });

    it("should return higher complexity for larger graphs", () => {
      const layout = new TestLayout();
      const largeGraph: GraphData = {
        nodes: Array.from({ length: 500 }, (_, i) => ({
          id: `node-${i}`,
          label: `Node ${i}`,
          path: `/node-${i}.md`,
        })),
        edges: Array.from({ length: 2000 }, (_, i) => ({
          id: `edge-${i}`,
          source: `node-${Math.floor(Math.random() * 500)}`,
          target: `node-${Math.floor(Math.random() * 500)}`,
        })),
      };

      const complexity = layout.estimateComplexity(largeGraph);
      expect(complexity).toBeGreaterThan(0.2);
    });
  });

  describe("cancel / destroy", () => {
    it("should not throw when cancelling", () => {
      const layout = new TestLayout();
      expect(() => layout.cancel()).not.toThrow();
    });

    it("should not throw when destroying", () => {
      const layout = new TestLayout();
      expect(() => layout.destroy()).not.toThrow();
    });
  });

  describe("helper methods", () => {
    it("should find root nodes", () => {
      const layout = new TestLayout();
      const graph = createTreeGraph();

      // Access protected method via any
      const roots = (layout as any).findRootNodes(graph);
      expect(roots).toContain("root");
      expect(roots.length).toBe(1);
    });

    it("should find leaf nodes", () => {
      const layout = new TestLayout();
      const graph = createTreeGraph();

      const leaves = (layout as any).findLeafNodes(graph);
      expect(leaves).toContain("grandchild1");
      expect(leaves).toContain("grandchild2");
      expect(leaves).toContain("child2");
    });

    it("should calculate degrees", () => {
      const layout = new TestLayout();
      const graph = createTreeGraph();

      const degrees = (layout as any).calculateDegrees(graph);
      expect(degrees.get("root")).toEqual({ in: 0, out: 2, total: 2 });
      expect(degrees.get("child1")).toEqual({ in: 1, out: 2, total: 3 });
    });

    it("should detect cycles", () => {
      const layout = new TestLayout();
      const cyclicGraph = createCyclicGraph();
      const treeGraph = createTreeGraph();

      expect((layout as any).hasCycles(cyclicGraph)).toBe(true);
      expect((layout as any).hasCycles(treeGraph)).toBe(false);
    });

    it("should find connected components", () => {
      const layout = new TestLayout();
      const disconnectedGraph: GraphData = {
        nodes: [
          { id: "a1", label: "A1", path: "/a1.md" },
          { id: "a2", label: "A2", path: "/a2.md" },
          { id: "b1", label: "B1", path: "/b1.md" },
          { id: "b2", label: "B2", path: "/b2.md" },
        ],
        edges: [
          { id: "e1", source: "a1", target: "a2" },
          { id: "e2", source: "b1", target: "b2" },
        ],
      };

      const components = (layout as any).getConnectedComponents(disconnectedGraph);
      expect(components.length).toBe(2);
    });

    it("should check if graph is tree", () => {
      const layout = new TestLayout();
      const treeGraph = createTreeGraph();
      const cyclicGraph = createCyclicGraph();

      expect((layout as any).isTree(treeGraph)).toBe(true);
      expect((layout as any).isTree(cyclicGraph)).toBe(false);
    });

    it("should calculate shortest path distances", () => {
      const layout = new TestLayout();
      const graph = createTreeGraph();

      const distances = (layout as any).shortestPathDistances(graph, "root");
      expect(distances.get("root")).toBe(0);
      expect(distances.get("child1")).toBe(1);
      expect(distances.get("grandchild1")).toBe(2);
    });
  });
});

// ============================================================
// LayoutPluginRegistry Tests
// ============================================================

describe("LayoutPluginRegistry", () => {
  let registry: LayoutPluginRegistry;

  beforeEach(() => {
    registry = new LayoutPluginRegistry();
  });

  describe("register", () => {
    it("should register a plugin", () => {
      const plugin = createTestPlugin();
      registry.register(plugin);

      expect(registry.has("test-plugin")).toBe(true);
    });

    it("should throw when registering duplicate ID", () => {
      const plugin1 = createTestPlugin("duplicate");
      const plugin2 = createTestPlugin("duplicate");

      registry.register(plugin1);
      expect(() => registry.register(plugin2)).toThrow('Plugin with ID "duplicate" is already registered');
    });

    it("should emit pluginRegistered event", () => {
      const events: PluginRegistryEvent[] = [];
      registry.on("pluginRegistered", (e) => events.push(e));

      const plugin = createTestPlugin();
      registry.register(plugin);

      expect(events.length).toBe(1);
      expect(events[0].type).toBe("pluginRegistered");
      expect(events[0].plugin).toBe(plugin);
    });
  });

  describe("unregister", () => {
    it("should unregister a plugin", () => {
      const plugin = createTestPlugin();
      registry.register(plugin);

      const result = registry.unregister("test-plugin");

      expect(result).toBe(true);
      expect(registry.has("test-plugin")).toBe(false);
    });

    it("should return false for non-existent plugin", () => {
      const result = registry.unregister("non-existent");
      expect(result).toBe(false);
    });

    it("should emit pluginUnregistered event", () => {
      const events: PluginRegistryEvent[] = [];
      const plugin = createTestPlugin();
      registry.register(plugin);

      registry.on("pluginUnregistered", (e) => events.push(e));
      registry.unregister("test-plugin");

      expect(events.length).toBe(1);
      expect(events[0].type).toBe("pluginUnregistered");
    });
  });

  describe("update", () => {
    it("should update an existing plugin", () => {
      const plugin1 = createTestPlugin();
      registry.register(plugin1);

      const plugin2: LayoutPlugin = {
        ...plugin1,
        metadata: { ...plugin1.metadata, version: "2.0.0" },
      };
      registry.update(plugin2);

      expect(registry.get("test-plugin")?.metadata.version).toBe("2.0.0");
    });

    it("should throw when updating non-existent plugin", () => {
      const plugin = createTestPlugin();
      expect(() => registry.update(plugin)).toThrow('Plugin with ID "test-plugin" is not registered');
    });

    it("should emit pluginUpdated event", () => {
      const events: PluginRegistryEvent[] = [];
      const plugin = createTestPlugin();
      registry.register(plugin);

      registry.on("pluginUpdated", (e) => events.push(e));
      registry.update({ ...plugin, metadata: { ...plugin.metadata, version: "2.0.0" } });

      expect(events.length).toBe(1);
      expect(events[0].type).toBe("pluginUpdated");
    });
  });

  describe("get", () => {
    it("should return registered plugin", () => {
      const plugin = createTestPlugin();
      registry.register(plugin);

      expect(registry.get("test-plugin")).toBe(plugin);
    });

    it("should return undefined for non-existent plugin", () => {
      expect(registry.get("non-existent")).toBeUndefined();
    });
  });

  describe("has", () => {
    it("should return true for registered plugin", () => {
      const plugin = createTestPlugin();
      registry.register(plugin);

      expect(registry.has("test-plugin")).toBe(true);
    });

    it("should return false for non-existent plugin", () => {
      expect(registry.has("non-existent")).toBe(false);
    });
  });

  describe("getAll", () => {
    it("should return all registered plugins", () => {
      registry.register(createTestPlugin("plugin-1"));
      registry.register(createTestPlugin("plugin-2"));
      registry.register(createTestPlugin("plugin-3"));

      const plugins = registry.getAll();
      expect(plugins.length).toBe(3);
    });

    it("should return empty array when no plugins", () => {
      expect(registry.getAll()).toEqual([]);
    });
  });

  describe("getIds", () => {
    it("should return all plugin IDs", () => {
      registry.register(createTestPlugin("plugin-a"));
      registry.register(createTestPlugin("plugin-b"));

      const ids = registry.getIds();
      expect(ids).toContain("plugin-a");
      expect(ids).toContain("plugin-b");
    });
  });

  describe("findPlugins", () => {
    beforeEach(() => {
      // Register diverse plugins for filtering tests
      registry.register(createLayoutPlugin(
        TestLayout,
        {
          id: "hierarchical-1",
          name: "Hierarchical Layout",
          description: "Tree visualization",
          version: "1.0.0",
          category: "hierarchical",
          tags: ["tree", "hierarchy"],
          supportedGraphTypes: ["tree", "dag"],
        },
        []
      ));

      registry.register(createLayoutPlugin(
        TestLayout,
        {
          id: "force-1",
          name: "Force Layout",
          description: "Force-directed graph",
          version: "1.0.0",
          category: "force-based",
          tags: ["force", "physics"],
          supportedGraphTypes: ["general"],
        },
        []
      ));

      registry.register(createLayoutPlugin(
        TestLayout,
        {
          id: "radial-1",
          name: "Radial Layout",
          description: "Radial tree layout",
          version: "1.0.0",
          category: "radial",
          tags: ["radial", "tree"],
          supportedGraphTypes: ["tree"],
          minNodes: 5,
          maxNodes: 100,
        },
        []
      ));
    });

    it("should filter by category", () => {
      const plugins = registry.findPlugins({ category: "hierarchical" });
      expect(plugins.length).toBe(1);
      expect(plugins[0].metadata.id).toBe("hierarchical-1");
    });

    it("should filter by graphType", () => {
      const plugins = registry.findPlugins({ graphType: "tree" });
      expect(plugins.length).toBe(2);
    });

    it("should filter by tag", () => {
      const plugins = registry.findPlugins({ tag: "tree" });
      expect(plugins.length).toBe(2);
    });

    it("should filter by search term", () => {
      const plugins = registry.findPlugins({ search: "force" });
      expect(plugins.length).toBe(1);
      expect(plugins[0].metadata.id).toBe("force-1");
    });

    it("should filter by minNodes", () => {
      // Filter finds plugins that can handle graphs with at least 50 nodes
      // radial-1 has maxNodes=100, so it can handle 50 nodes
      // Plugins without maxNodes can handle any size
      const plugins = registry.findPlugins({ minNodes: 50 });
      expect(plugins.length).toBe(3);
    });

    it("should filter by maxNodes", () => {
      // Filter finds plugins that can handle graphs with at most 3 nodes
      // radial-1 has minNodes=5, so it's excluded
      // Plugins without minNodes can handle any size
      const plugins = registry.findPlugins({ maxNodes: 3 });
      expect(plugins.length).toBe(2);
    });

    it("should combine filters", () => {
      const plugins = registry.findPlugins({
        category: "radial",
        tag: "tree",
      });
      expect(plugins.length).toBe(1);
      expect(plugins[0].metadata.id).toBe("radial-1");
    });
  });

  describe("findSuitablePlugins", () => {
    it("should filter by graph node count", () => {
      registry.register(createLayoutPlugin(
        TestLayout,
        {
          id: "small-only",
          name: "Small Layout",
          description: "For small graphs",
          version: "1.0.0",
          category: "grid",
          tags: [],
          supportedGraphTypes: ["general"],
          minNodes: 1,
          maxNodes: 10,
        },
        []
      ));

      const largeGraph = createTestGraph(50);
      const plugins = registry.findSuitablePlugins(largeGraph);

      expect(plugins.every((p) => p.metadata.id !== "small-only")).toBe(true);
    });

    it("should sort by category preference", () => {
      registry.register(createLayoutPlugin(
        TestLayout,
        {
          id: "domain-1",
          name: "Domain Layout",
          description: "Domain-specific",
          version: "1.0.0",
          category: "domain-specific",
          tags: [],
          supportedGraphTypes: ["general"],
        },
        []
      ));

      registry.register(createLayoutPlugin(
        TestLayout,
        {
          id: "grid-1",
          name: "Grid Layout",
          description: "Grid layout",
          version: "1.0.0",
          category: "grid",
          tags: [],
          supportedGraphTypes: ["general"],
        },
        []
      ));

      const graph = createTestGraph(5);
      const plugins = registry.findSuitablePlugins(graph);

      // Domain-specific should come first
      expect(plugins[0].metadata.category).toBe("domain-specific");
    });
  });

  describe("createLayout", () => {
    it("should create layout instance from plugin", () => {
      const plugin = createTestPlugin();
      registry.register(plugin);

      const layout = registry.createLayout("test-plugin");
      expect(layout.name).toBe("test-layout");
    });

    it("should pass options to layout", () => {
      const plugin = createTestPlugin();
      registry.register(plugin);

      const layout = registry.createLayout("test-plugin", { spacing: 100 });
      expect(layout.getOptions().spacing).toBe(100);
    });

    it("should throw for non-existent plugin", () => {
      expect(() => registry.createLayout("non-existent")).toThrow('Plugin "non-existent" not found');
    });
  });

  describe("getOptionDefinitions", () => {
    it("should return option definitions for plugin", () => {
      const plugin = createTestPlugin();
      registry.register(plugin);

      const options = registry.getOptionDefinitions("test-plugin");
      expect(options.length).toBe(3);
      expect(options[0].name).toBe("spacing");
    });

    it("should throw for non-existent plugin", () => {
      expect(() => registry.getOptionDefinitions("non-existent")).toThrow('Plugin "non-existent" not found');
    });
  });

  describe("validateOptions", () => {
    it("should validate options for plugin", () => {
      const plugin = createTestPlugin();
      registry.register(plugin);

      const result = registry.validateOptions("test-plugin", { spacing: 100 });
      expect(result.valid).toBe(true);
    });

    it("should throw for non-existent plugin", () => {
      expect(() => registry.validateOptions("non-existent", {})).toThrow('Plugin "non-existent" not found');
    });
  });

  describe("getByCategory", () => {
    it("should group plugins by category", () => {
      registry.register(createLayoutPlugin(
        TestLayout,
        { id: "h1", name: "H1", description: "", version: "1.0.0", category: "hierarchical", tags: [], supportedGraphTypes: [] },
        []
      ));
      registry.register(createLayoutPlugin(
        TestLayout,
        { id: "h2", name: "H2", description: "", version: "1.0.0", category: "hierarchical", tags: [], supportedGraphTypes: [] },
        []
      ));
      registry.register(createLayoutPlugin(
        TestLayout,
        { id: "f1", name: "F1", description: "", version: "1.0.0", category: "force-based", tags: [], supportedGraphTypes: [] },
        []
      ));

      const byCategory = registry.getByCategory();
      expect(byCategory.get("hierarchical")?.length).toBe(2);
      expect(byCategory.get("force-based")?.length).toBe(1);
    });
  });

  describe("event listeners", () => {
    it("should add and remove listeners", () => {
      const events: PluginRegistryEvent[] = [];
      const listener = (e: PluginRegistryEvent) => events.push(e);

      registry.on("pluginRegistered", listener);
      registry.register(createTestPlugin("p1"));
      expect(events.length).toBe(1);

      registry.off("pluginRegistered", listener);
      registry.register(createTestPlugin("p2"));
      expect(events.length).toBe(1); // No new events
    });

    it("should handle errors in listeners gracefully", () => {
      const errorSpy = jest.spyOn(console, "error").mockImplementation();

      registry.on("pluginRegistered", () => {
        throw new Error("Test error");
      });

      expect(() => registry.register(createTestPlugin())).not.toThrow();
      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
    });
  });

  describe("clear", () => {
    it("should remove all plugins", () => {
      registry.register(createTestPlugin("p1"));
      registry.register(createTestPlugin("p2"));

      registry.clear();

      expect(registry.getAll().length).toBe(0);
    });

    it("should emit unregister events for each plugin", () => {
      registry.register(createTestPlugin("p1"));
      registry.register(createTestPlugin("p2"));

      const events: PluginRegistryEvent[] = [];
      registry.on("pluginUnregistered", (e) => events.push(e));

      registry.clear();

      expect(events.length).toBe(2);
    });
  });
});

// ============================================================
// Factory Functions Tests
// ============================================================

describe("createLayoutFactory", () => {
  it("should create a factory with create method", () => {
    const factory = createLayoutFactory(TestLayout, TestLayout.OPTION_DEFINITIONS);

    const layout = factory.create({ spacing: 100 });
    expect(layout.name).toBe("test-layout");
    expect(layout.getOptions().spacing).toBe(100);
  });

  it("should create a factory with getOptionDefinitions method", () => {
    const factory = createLayoutFactory(TestLayout, TestLayout.OPTION_DEFINITIONS);

    const definitions = factory.getOptionDefinitions();
    expect(definitions.length).toBe(3);
  });

  describe("validateOptions", () => {
    const factory = createLayoutFactory(TestLayout, TestLayout.OPTION_DEFINITIONS);

    it("should validate valid options", () => {
      const result = factory.validateOptions({ spacing: 100 });
      expect(result.valid).toBe(true);
      expect(Object.keys(result.errors).length).toBe(0);
    });

    it("should reject non-number for number option", () => {
      const result = factory.validateOptions({ spacing: "not a number" });
      expect(result.valid).toBe(false);
      expect(result.errors.spacing).toBeDefined();
    });

    it("should reject number below min", () => {
      const result = factory.validateOptions({ spacing: 5 });
      expect(result.valid).toBe(false);
      expect(result.errors.spacing).toContain("at least 10");
    });

    it("should reject number above max", () => {
      const result = factory.validateOptions({ spacing: 300 });
      expect(result.valid).toBe(false);
      expect(result.errors.spacing).toContain("at most 200");
    });

    it("should reject non-boolean for boolean option", () => {
      const result = factory.validateOptions({ horizontal: "yes" });
      expect(result.valid).toBe(false);
      expect(result.errors.horizontal).toBeDefined();
    });

    it("should reject invalid select option", () => {
      const result = factory.validateOptions({ direction: "invalid" });
      expect(result.valid).toBe(false);
      expect(result.errors.direction).toBeDefined();
    });

    it("should accept valid select option", () => {
      const result = factory.validateOptions({ direction: "tb" });
      expect(result.valid).toBe(true);
    });

    it("should skip undefined options", () => {
      const result = factory.validateOptions({});
      expect(result.valid).toBe(true);
    });

    it("should handle NaN for number options", () => {
      const result = factory.validateOptions({ spacing: NaN });
      expect(result.valid).toBe(false);
      expect(result.errors.spacing).toBeDefined();
    });
  });
});

describe("createLayoutPlugin", () => {
  it("should create a complete plugin", () => {
    const plugin = createTestPlugin();

    expect(plugin.metadata.id).toBe("test-plugin");
    expect(plugin.metadata.name).toBe("Test Layout");
    expect(plugin.factory).toBeDefined();
  });

  it("should create plugin with working factory", () => {
    const plugin = createTestPlugin();
    const layout = plugin.factory.create();

    const graph = createTestGraph(3);
    const result = layout.layout(graph);

    expect(result.positions.size).toBe(3);
  });
});

describe("createBuiltInLayoutPlugin", () => {
  it("should create plugin for built-in layout", () => {
    const plugin = createBuiltInLayoutPlugin(
      "force",
      { name: "Force-Directed", category: "force-based" }
    );

    expect(plugin.metadata.id).toBe("builtin-force");
    expect(plugin.metadata.name).toBe("Force-Directed");
  });

  it("should throw when trying to use layout directly", () => {
    const plugin = createBuiltInLayoutPlugin("grid", {});
    const layout = plugin.factory.create();

    const graph = createTestGraph(3);
    expect(() => layout.layout(graph)).toThrow("should be used through LayoutManager");
  });
});

// ============================================================
// Global Registry Tests
// ============================================================

describe("layoutPluginRegistry", () => {
  afterEach(() => {
    layoutPluginRegistry.clear();
  });

  it("should be a singleton", () => {
    expect(layoutPluginRegistry).toBeInstanceOf(LayoutPluginRegistry);
  });

  it("should allow registering plugins globally", () => {
    const plugin = createTestPlugin("global-test");
    layoutPluginRegistry.register(plugin);

    expect(layoutPluginRegistry.has("global-test")).toBe(true);
  });
});

// ============================================================
// Edge Cases Tests
// ============================================================

describe("Edge Cases", () => {
  describe("empty graph handling", () => {
    it("should handle empty graph in layout", () => {
      const layout = new TestLayout();
      const graph: GraphData = { nodes: [], edges: [] };

      const result = layout.layout(graph);
      expect(result.positions.size).toBe(0);
      expect(result.bounds.width).toBe(0);
    });

    it("should return false for canLayout with empty graph", () => {
      const layout = new TestLayout();
      const graph: GraphData = { nodes: [], edges: [] };

      expect(layout.canLayout(graph)).toBe(false);
    });
  });

  describe("single node graph", () => {
    it("should handle single node", () => {
      const layout = new TestLayout();
      const graph: GraphData = {
        nodes: [{ id: "single", label: "Single", path: "/single.md" }],
        edges: [],
      };

      const result = layout.layout(graph);
      expect(result.positions.size).toBe(1);
      expect(result.positions.get("single")).toEqual({ x: 0, y: 0 });
    });
  });

  describe("disconnected graph", () => {
    it("should handle disconnected nodes", () => {
      const layout = new TestLayout();
      const graph: GraphData = {
        nodes: [
          { id: "a", label: "A", path: "/a.md" },
          { id: "b", label: "B", path: "/b.md" },
          { id: "c", label: "C", path: "/c.md" },
        ],
        edges: [],
      };

      const result = layout.layout(graph);
      expect(result.positions.size).toBe(3);
    });
  });

  describe("self-loops", () => {
    it("should handle self-loops in graph analysis", () => {
      const layout = new TestLayout();
      const graph: GraphData = {
        nodes: [{ id: "a", label: "A", path: "/a.md" }],
        edges: [{ id: "e1", source: "a", target: "a" }],
      };

      // Should not throw
      expect(() => (layout as any).hasCycles(graph)).not.toThrow();
      expect((layout as any).hasCycles(graph)).toBe(true);
    });
  });

  describe("option validation edge cases", () => {
    const factory = createLayoutFactory(TestLayout, [
      { name: "color", type: "color", label: "Color", default: "#FF0000" },
      { name: "custom", type: "string", label: "Custom", default: "", validate: (v) => String(v).length > 0 },
    ]);

    it("should warn for invalid color format", () => {
      const result = factory.validateOptions({ color: "red" });
      expect(result.valid).toBe(true); // Warning, not error
      expect(result.warnings.color).toBeDefined();
    });

    it("should accept valid hex color", () => {
      const result = factory.validateOptions({ color: "#00FF00" });
      expect(result.valid).toBe(true);
      expect(Object.keys(result.warnings).length).toBe(0);
    });

    it("should handle custom validation failure", () => {
      const result = factory.validateOptions({ custom: "" });
      expect(result.valid).toBe(false);
      expect(result.errors.custom).toBeDefined();
    });
  });
});

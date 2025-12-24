/**
 * FilterManager Unit Tests
 *
 * Tests for the graph filter management system.
 */

import type { GraphNode, GraphEdge } from "exocortex";
import {
  FilterManager,
  resetFilterManager,
  createTypeFilter,
  createPredicateFilter,
  createLiteralFilter,
  createPathFilter,
  createCompositeFilter,
  generateFilterId,
} from "../../../../../../src/presentation/renderers/graph/filter";

describe("FilterManager", () => {
  let manager: FilterManager;
  let nodes: Map<string, GraphNode>;
  let edges: Map<string, GraphEdge>;

  beforeEach(() => {
    resetFilterManager();
    manager = new FilterManager();

    // Create test nodes
    nodes = new Map([
      [
        "task1",
        {
          id: "task1",
          path: "/tasks/task1.md",
          title: "Task 1",
          label: "Task 1",
          assetClass: "ems__Task",
          isArchived: false,
          properties: { priority: "high", count: 5 },
        },
      ],
      [
        "task2",
        {
          id: "task2",
          path: "/tasks/task2.md",
          title: "Task 2",
          label: "Task 2",
          assetClass: "ems__Task",
          isArchived: false,
          properties: { priority: "low", count: 10 },
        },
      ],
      [
        "project1",
        {
          id: "project1",
          path: "/projects/project1.md",
          title: "Project 1",
          label: "Project 1",
          assetClass: "ems__Project",
          isArchived: false,
          properties: { status: "active" },
        },
      ],
      [
        "area1",
        {
          id: "area1",
          path: "/areas/area1.md",
          title: "Area 1",
          label: "Area 1",
          assetClass: "ems__Area",
          isArchived: false,
        },
      ],
    ]);

    // Create test edges
    edges = new Map([
      [
        "edge1",
        {
          id: "edge1",
          source: "project1",
          target: "task1",
          type: "hierarchy",
          predicate: "ems:parent",
        },
      ],
      [
        "edge2",
        {
          id: "edge2",
          source: "project1",
          target: "task2",
          type: "hierarchy",
          predicate: "ems:parent",
        },
      ],
      [
        "edge3",
        {
          id: "edge3",
          source: "area1",
          target: "project1",
          type: "hierarchy",
          predicate: "ems:parent",
        },
      ],
      [
        "edge4",
        {
          id: "edge4",
          source: "task1",
          target: "task2",
          type: "reference",
          predicate: "exo:references",
        },
      ],
    ]);

    manager.setGraphData(nodes, edges);
  });

  describe("setGraphData", () => {
    it("should accept graph data", () => {
      const stats = manager.getStats();
      expect(stats.totalNodes).toBe(4);
      expect(stats.totalEdges).toBe(4);
    });

    it("should invalidate cached results when data changes", () => {
      // Add a filter
      manager.addFilter(createTypeFilter("test", ["ems__Task"], true, false));

      // Get results to populate cache
      const result1 = manager.getFilteredResults();
      expect(result1.nodeIds.size).toBe(2);

      // Change data
      const newNodes = new Map(nodes);
      newNodes.set("task3", {
        id: "task3",
        path: "/tasks/task3.md",
        title: "Task 3",
        label: "Task 3",
        assetClass: "ems__Task",
        isArchived: false,
      });
      manager.setGraphData(newNodes, edges);

      // Results should reflect new data
      const result2 = manager.getFilteredResults();
      expect(result2.nodeIds.size).toBe(3);
    });
  });

  describe("addFilter", () => {
    it("should add a filter to active filters", () => {
      const filter = createTypeFilter("test", ["ems__Task"], true, false);
      manager.addFilter(filter);

      const activeFilters = manager.getActiveFilters();
      expect(activeFilters).toHaveLength(1);
      expect(activeFilters[0].id).toBe("test");
    });

    it("should notify listeners when filter is added", () => {
      const callback = jest.fn();
      manager.subscribe(callback);

      manager.addFilter(createTypeFilter("test", ["ems__Task"], true, false));

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe("removeFilter", () => {
    it("should remove a filter by ID", () => {
      manager.addFilter(createTypeFilter("test", ["ems__Task"], true, false));
      expect(manager.getActiveFilters()).toHaveLength(1);

      manager.removeFilter("test");
      expect(manager.getActiveFilters()).toHaveLength(0);
    });

    it("should not throw when removing non-existent filter", () => {
      expect(() => manager.removeFilter("non-existent")).not.toThrow();
    });
  });

  describe("toggleFilter", () => {
    it("should toggle filter enabled state", () => {
      manager.addFilter(createTypeFilter("test", ["ems__Task"], true, false));

      let filter = manager.getFilter("test");
      expect(filter?.enabled).toBe(true);

      manager.toggleFilter("test");
      filter = manager.getFilter("test");
      expect(filter?.enabled).toBe(false);

      manager.toggleFilter("test");
      filter = manager.getFilter("test");
      expect(filter?.enabled).toBe(true);
    });
  });

  describe("clearAllFilters", () => {
    it("should remove all filters", () => {
      manager.addFilter(createTypeFilter("filter1", ["ems__Task"], true, false));
      manager.addFilter(createTypeFilter("filter2", ["ems__Project"], true, false));

      expect(manager.getActiveFilters()).toHaveLength(2);

      manager.clearAllFilters();

      expect(manager.getActiveFilters()).toHaveLength(0);
    });
  });

  describe("Type Filter", () => {
    it("should filter nodes by type (include)", () => {
      manager.addFilter(createTypeFilter("test", ["ems__Task"], true, false));

      const result = manager.getFilteredResults();
      expect(result.nodeIds.size).toBe(2);
      expect(result.nodeIds.has("task1")).toBe(true);
      expect(result.nodeIds.has("task2")).toBe(true);
      expect(result.nodeIds.has("project1")).toBe(false);
    });

    it("should filter nodes by type (exclude)", () => {
      manager.addFilter(createTypeFilter("test", ["ems__Task"], false, false));

      const result = manager.getFilteredResults();
      expect(result.nodeIds.size).toBe(2);
      expect(result.nodeIds.has("task1")).toBe(false);
      expect(result.nodeIds.has("task2")).toBe(false);
      expect(result.nodeIds.has("project1")).toBe(true);
      expect(result.nodeIds.has("area1")).toBe(true);
    });

    it("should filter multiple types", () => {
      manager.addFilter(createTypeFilter("test", ["ems__Task", "ems__Project"], true, false));

      const result = manager.getFilteredResults();
      expect(result.nodeIds.size).toBe(3);
    });
  });

  describe("Predicate Filter", () => {
    it("should filter nodes connected by predicate (outgoing)", () => {
      manager.addFilter(
        createPredicateFilter("test", ["ems:parent"], true, "outgoing")
      );

      const result = manager.getFilteredResults();
      // project1 and area1 have outgoing ems:parent edges
      expect(result.nodeIds.has("project1")).toBe(true);
      expect(result.nodeIds.has("area1")).toBe(true);
    });

    it("should filter nodes connected by predicate (incoming)", () => {
      manager.addFilter(
        createPredicateFilter("test", ["ems:parent"], true, "incoming")
      );

      const result = manager.getFilteredResults();
      // task1, task2, project1 have incoming ems:parent edges
      expect(result.nodeIds.has("task1")).toBe(true);
      expect(result.nodeIds.has("task2")).toBe(true);
      expect(result.nodeIds.has("project1")).toBe(true);
      expect(result.nodeIds.has("area1")).toBe(false);
    });
  });

  describe("Literal Filter", () => {
    it("should filter by equals", () => {
      manager.addFilter(createLiteralFilter("test", "priority", "equals", "high"));

      const result = manager.getFilteredResults();
      expect(result.nodeIds.size).toBe(1);
      expect(result.nodeIds.has("task1")).toBe(true);
    });

    it("should filter by contains", () => {
      manager.addFilter(createLiteralFilter("test", "priority", "contains", "ig"));

      const result = manager.getFilteredResults();
      expect(result.nodeIds.has("task1")).toBe(true); // "high" contains "ig"
    });

    it("should filter by gt (greater than)", () => {
      manager.addFilter(createLiteralFilter("test", "count", "gt", 7));

      const result = manager.getFilteredResults();
      expect(result.nodeIds.size).toBe(1);
      expect(result.nodeIds.has("task2")).toBe(true); // count: 10 > 7
    });

    it("should filter by between", () => {
      manager.addFilter(createLiteralFilter("test", "count", "between", [4, 8]));

      const result = manager.getFilteredResults();
      expect(result.nodeIds.has("task1")).toBe(true); // count: 5 is between 4-8
      expect(result.nodeIds.has("task2")).toBe(false); // count: 10 is not between 4-8
    });
  });

  describe("Path Filter", () => {
    it("should filter by distance from start node", () => {
      // Distance 1 from project1
      manager.addFilter(createPathFilter("test", "project1", 1));

      const result = manager.getFilteredResults();
      // project1 (distance 0), task1, task2, area1 (all distance 1)
      expect(result.nodeIds.has("project1")).toBe(true);
      expect(result.nodeIds.has("task1")).toBe(true);
      expect(result.nodeIds.has("task2")).toBe(true);
      expect(result.nodeIds.has("area1")).toBe(true);
    });

    it("should respect predicate restriction in path filter", () => {
      // Only traverse hierarchy edges from project1
      manager.addFilter(createPathFilter("test", "project1", 1, ["hierarchy"]));

      const result = manager.getFilteredResults();
      expect(result.nodeIds.has("project1")).toBe(true);
      expect(result.nodeIds.has("task1")).toBe(true);
      expect(result.nodeIds.has("task2")).toBe(true);
      expect(result.nodeIds.has("area1")).toBe(true);
    });
  });

  describe("Composite Filter", () => {
    it("should combine filters with AND", () => {
      const compositeFilter = createCompositeFilter("test", "AND", [
        createTypeFilter("type", ["ems__Task"], true, false),
        createLiteralFilter("lit", "priority", "equals", "high"),
      ]);

      manager.addFilter(compositeFilter);

      const result = manager.getFilteredResults();
      expect(result.nodeIds.size).toBe(1);
      expect(result.nodeIds.has("task1")).toBe(true);
    });

    it("should combine filters with OR", () => {
      const compositeFilter = createCompositeFilter("test", "OR", [
        createTypeFilter("type", ["ems__Project"], true, false),
        createLiteralFilter("lit", "priority", "equals", "high"),
      ]);

      manager.addFilter(compositeFilter);

      const result = manager.getFilteredResults();
      expect(result.nodeIds.size).toBe(2);
      expect(result.nodeIds.has("project1")).toBe(true);
      expect(result.nodeIds.has("task1")).toBe(true);
    });

    it("should apply NOT to first child filter", () => {
      const compositeFilter = createCompositeFilter("test", "NOT", [
        createTypeFilter("type", ["ems__Task"], true, false),
      ]);

      manager.addFilter(compositeFilter);

      const result = manager.getFilteredResults();
      expect(result.nodeIds.size).toBe(2);
      expect(result.nodeIds.has("project1")).toBe(true);
      expect(result.nodeIds.has("area1")).toBe(true);
    });
  });

  describe("Edge Filtering", () => {
    it("should filter edges based on visible nodes", () => {
      manager.addFilter(createTypeFilter("test", ["ems__Task"], true, false));

      const result = manager.getFilteredResults();

      // Only edge4 (task1 -> task2) should be visible, others connect to non-visible nodes
      expect(result.edgeIds.has("edge4")).toBe(true);
      expect(result.edgeIds.has("edge1")).toBe(false);
      expect(result.edgeIds.has("edge2")).toBe(false);
      expect(result.edgeIds.has("edge3")).toBe(false);
    });
  });

  describe("getFilteredData", () => {
    it("should return filtered nodes and edges as arrays", () => {
      manager.addFilter(createTypeFilter("test", ["ems__Task"], true, false));

      const data = manager.getFilteredData();
      expect(data.nodes).toHaveLength(2);
      expect(data.edges).toHaveLength(1);
    });
  });

  describe("getTypeCounts", () => {
    it("should return counts for each type", () => {
      const counts = manager.getTypeCounts();

      expect(counts.nodeTypes.get("ems__Task")).toBe(2);
      expect(counts.nodeTypes.get("ems__Project")).toBe(1);
      expect(counts.nodeTypes.get("ems__Area")).toBe(1);
      expect(counts.edgeTypes.get("hierarchy")).toBe(3);
      expect(counts.edgeTypes.get("reference")).toBe(1);
    });
  });

  describe("getNodeTypes / getEdgeTypes", () => {
    it("should return unique sorted types", () => {
      const nodeTypes = manager.getNodeTypes();
      expect(nodeTypes).toEqual(["ems__Area", "ems__Project", "ems__Task"]);

      const edgeTypes = manager.getEdgeTypes();
      expect(edgeTypes).toEqual(["hierarchy", "reference"]);
    });
  });

  describe("Presets", () => {
    it("should save and load presets", () => {
      manager.addFilter(createTypeFilter("filter1", ["ems__Task"], true, false));
      const preset = manager.savePreset("Tasks Only", "Show only tasks");

      expect(preset.name).toBe("Tasks Only");
      expect(preset.filters).toHaveLength(1);

      // Clear filters
      manager.clearAllFilters();
      expect(manager.getActiveFilters()).toHaveLength(0);

      // Load preset
      const success = manager.loadPreset(preset.id);
      expect(success).toBe(true);
      expect(manager.getActiveFilters()).toHaveLength(1);
    });

    it("should delete presets", () => {
      const preset = manager.savePreset("Test", "Test preset");
      expect(manager.getPresets()).toHaveLength(1);

      manager.deletePreset(preset.id);
      expect(manager.getPresets()).toHaveLength(0);
    });
  });

  describe("Quick Filters", () => {
    it("should create quick type filter", () => {
      const filterId = manager.quickFilterByType("ems__Task");

      expect(manager.getFilter(filterId)).toBeDefined();
      const result = manager.getFilteredResults();
      expect(result.nodeIds.size).toBe(2);
    });

    it("should create quick path filter", () => {
      const filterId = manager.quickFilterByPath("project1", 1);

      expect(manager.getFilter(filterId)).toBeDefined();
      const result = manager.getFilteredResults();
      expect(result.nodeIds.size).toBe(4);
    });
  });

  describe("Statistics", () => {
    it("should return accurate stats", () => {
      manager.addFilter(createTypeFilter("test", ["ems__Task"], true, false));

      const stats = manager.getStats();
      expect(stats.totalFilters).toBe(1);
      expect(stats.enabledFilters).toBe(1);
      expect(stats.totalNodes).toBe(4);
      expect(stats.filteredNodes).toBe(2);
      expect(stats.totalEdges).toBe(4);
      expect(stats.filteredEdges).toBe(1);
    });
  });

  describe("Serialization", () => {
    it("should serialize and deserialize filters", () => {
      manager.addFilter(createTypeFilter("filter1", ["ems__Task"], true, false));
      manager.addFilter(createPredicateFilter("filter2", ["hierarchy"], true, "both"));

      const serialized = manager.serializeFilters();
      expect(serialized).toHaveLength(2);

      manager.clearAllFilters();
      manager.loadFilters(serialized as any);

      expect(manager.getActiveFilters()).toHaveLength(2);
    });
  });

  describe("Subscriber", () => {
    it("should allow unsubscribing", () => {
      const callback = jest.fn();
      const unsubscribe = manager.subscribe(callback);

      manager.addFilter(createTypeFilter("test", ["ems__Task"], true, false));
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      manager.removeFilter("test");
      expect(callback).toHaveBeenCalledTimes(1); // Still 1, not called again
    });
  });

  describe("Multiple Filters (AND logic)", () => {
    it("should apply multiple filters with AND logic by default", () => {
      manager.addFilter(createTypeFilter("type", ["ems__Task"], true, false));
      manager.addFilter(createLiteralFilter("lit", "priority", "equals", "high"));

      const result = manager.getFilteredResults();
      // Only task1 is ems__Task AND has priority="high"
      expect(result.nodeIds.size).toBe(1);
      expect(result.nodeIds.has("task1")).toBe(true);
    });
  });
});

describe("generateFilterId", () => {
  it("should generate unique IDs", () => {
    const id1 = generateFilterId();
    const id2 = generateFilterId();

    expect(id1).not.toBe(id2);
  });

  it("should use provided prefix", () => {
    const id = generateFilterId("custom");
    expect(id.startsWith("custom-")).toBe(true);
  });
});

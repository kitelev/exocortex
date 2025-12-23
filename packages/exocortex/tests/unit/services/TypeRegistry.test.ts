import { TypeRegistry } from "../../../src/services/TypeRegistry";
import {
  NodeTypeDefinition,
  EdgeTypeDefinition,
  TypeFilter,
  TypeGrouping,
  RDF_TYPE_PREDICATES,
  DEFAULT_NODE_STYLE,
  DEFAULT_EDGE_STYLE,
} from "../../../src/domain/models/GraphTypes";
import { GraphNode } from "../../../src/domain/models/GraphNode";
import { GraphEdge } from "../../../src/domain/models/GraphEdge";

describe("TypeRegistry", () => {
  let registry: TypeRegistry;

  beforeEach(() => {
    registry = new TypeRegistry(null, { includeBuiltInStyles: false });
  });

  describe("constructor", () => {
    it("should create empty registry when includeBuiltInStyles is false", () => {
      expect(registry.getAllNodeTypes()).toHaveLength(0);
      expect(registry.getAllEdgeTypes()).toHaveLength(0);
    });

    it("should include built-in styles when enabled", () => {
      const registryWithBuiltIn = new TypeRegistry(null, { includeBuiltInStyles: true });
      expect(registryWithBuiltIn.getAllNodeTypes().length).toBeGreaterThan(0);
      expect(registryWithBuiltIn.getAllEdgeTypes().length).toBeGreaterThan(0);
    });
  });

  describe("registerNodeType", () => {
    it("should register a new node type", () => {
      const def: NodeTypeDefinition = {
        uri: "http://example.org/Task",
        label: "Task",
        source: "custom",
        style: { color: "#00ff00" },
        priority: 1,
      };

      registry.registerNodeType(def);

      expect(registry.getNodeType("http://example.org/Task")).toEqual(def);
    });

    it("should update existing node type", () => {
      const def1: NodeTypeDefinition = {
        uri: "http://example.org/Task",
        label: "Task",
        source: "custom",
        style: { color: "#00ff00" },
        priority: 1,
      };

      const def2: NodeTypeDefinition = {
        uri: "http://example.org/Task",
        label: "Updated Task",
        source: "custom",
        style: { color: "#ff0000" },
        priority: 2,
      };

      registry.registerNodeType(def1);
      registry.registerNodeType(def2);

      const result = registry.getNodeType("http://example.org/Task");
      expect(result?.label).toBe("Updated Task");
      expect(result?.style.color).toBe("#ff0000");
    });

    it("should emit type-added event for new type", () => {
      const events: string[] = [];
      registry.subscribe(event => events.push(event.type));

      registry.registerNodeType({
        uri: "http://example.org/Task",
        label: "Task",
        source: "custom",
        style: {},
        priority: 1,
      });

      expect(events).toContain("type-added");
    });

    it("should emit type-updated event for existing type", () => {
      registry.registerNodeType({
        uri: "http://example.org/Task",
        label: "Task",
        source: "custom",
        style: {},
        priority: 1,
      });

      const events: string[] = [];
      registry.subscribe(event => events.push(event.type));

      registry.registerNodeType({
        uri: "http://example.org/Task",
        label: "Updated",
        source: "custom",
        style: {},
        priority: 1,
      });

      expect(events).toContain("type-updated");
    });
  });

  describe("registerEdgeType", () => {
    it("should register a new edge type", () => {
      const def: EdgeTypeDefinition = {
        uri: "http://example.org/hasParent",
        label: "has parent",
        source: "custom",
        style: { color: "#0000ff" },
        priority: 1,
      };

      registry.registerEdgeType(def);

      expect(registry.getEdgeType("http://example.org/hasParent")).toEqual(def);
    });

    it("should register edge type with domain and range", () => {
      const def: EdgeTypeDefinition = {
        uri: "http://example.org/assignedTo",
        label: "assigned to",
        domain: ["http://example.org/Task"],
        range: ["http://example.org/Person"],
        source: "custom",
        style: {},
        priority: 1,
      };

      registry.registerEdgeType(def);

      const result = registry.getEdgeType("http://example.org/assignedTo");
      expect(result?.domain).toContain("http://example.org/Task");
      expect(result?.range).toContain("http://example.org/Person");
    });
  });

  describe("unregisterType", () => {
    it("should unregister a node type", () => {
      registry.registerNodeType({
        uri: "http://example.org/Task",
        label: "Task",
        source: "custom",
        style: {},
        priority: 1,
      });

      registry.unregisterType("http://example.org/Task");

      expect(registry.getNodeType("http://example.org/Task")).toBeUndefined();
    });

    it("should emit type-removed event", () => {
      registry.registerNodeType({
        uri: "http://example.org/Task",
        label: "Task",
        source: "custom",
        style: {},
        priority: 1,
      });

      const events: string[] = [];
      registry.subscribe(event => events.push(event.type));

      registry.unregisterType("http://example.org/Task");

      expect(events).toContain("type-removed");
    });
  });

  describe("type hierarchy", () => {
    beforeEach(() => {
      // Set up a type hierarchy: Task -> Effort -> Thing
      registry.registerNodeType({
        uri: "http://example.org/Thing",
        label: "Thing",
        source: "custom",
        style: { color: "#aaaaaa" },
        priority: 0,
      });

      registry.registerNodeType({
        uri: "http://example.org/Effort",
        label: "Effort",
        parentTypes: ["http://example.org/Thing"],
        source: "custom",
        style: { color: "#666666" },
        priority: 1,
      });

      registry.registerNodeType({
        uri: "http://example.org/Task",
        label: "Task",
        parentTypes: ["http://example.org/Effort"],
        source: "custom",
        style: { color: "#00ff00" },
        priority: 2,
      });
    });

    it("should return direct parent types", () => {
      const parents = registry.getParentTypes("http://example.org/Task");
      expect(parents).toContain("http://example.org/Effort");
    });

    it("should return inherited parent types", () => {
      const parents = registry.getParentTypes("http://example.org/Task");
      expect(parents).toContain("http://example.org/Effort");
      expect(parents).toContain("http://example.org/Thing");
    });

    it("should respect max depth", () => {
      const parents = registry.getParentTypes("http://example.org/Task", 1);
      expect(parents).toContain("http://example.org/Effort");
      expect(parents).not.toContain("http://example.org/Thing");
    });

    it("should return child types", () => {
      const children = registry.getChildTypes("http://example.org/Effort");
      expect(children).toContain("http://example.org/Task");
    });

    it("should check subtype relationship", () => {
      expect(registry.isSubtypeOf("http://example.org/Task", "http://example.org/Effort")).toBe(true);
      expect(registry.isSubtypeOf("http://example.org/Task", "http://example.org/Thing")).toBe(true);
      expect(registry.isSubtypeOf("http://example.org/Thing", "http://example.org/Task")).toBe(false);
    });

    it("should return true for same type in isSubtypeOf", () => {
      expect(registry.isSubtypeOf("http://example.org/Task", "http://example.org/Task")).toBe(true);
    });
  });

  describe("resolveNodeType", () => {
    beforeEach(() => {
      registry.registerNodeType({
        uri: "ems__Task",
        label: "Task",
        source: "exo:Instance_class",
        style: { color: "#00ff00", shape: "circle" },
        priority: 1,
      });
    });

    it("should resolve type from assetClass", () => {
      const node: GraphNode = {
        id: "test-node",
        path: "test.md",
        title: "Test",
        label: "Test",
        assetClass: "[[ems__Task]]",
        isArchived: false,
      };

      const typeInfo = registry.resolveNodeType(node);

      expect(typeInfo.primaryType).toBe("ems__Task");
      expect(typeInfo.types).toContain("ems__Task");
      expect(typeInfo.source).toBe("exo:Instance_class");
    });

    it("should resolve style from type", () => {
      const node: GraphNode = {
        id: "test-node",
        path: "test.md",
        title: "Test",
        label: "Test",
        assetClass: "ems__Task",
        isArchived: false,
      };

      const typeInfo = registry.resolveNodeType(node);

      expect(typeInfo.resolvedStyle.color).toBe("#00ff00");
      expect(typeInfo.resolvedStyle.shape).toBe("circle");
    });

    it("should return unknown type when no type info", () => {
      const node: GraphNode = {
        id: "test-node",
        path: "test.md",
        title: "Test",
        label: "Test",
        isArchived: false,
      };

      const typeInfo = registry.resolveNodeType(node);

      expect(typeInfo.primaryType).toBe("unknown");
    });

    it("should include rdf:type from properties", () => {
      const node: GraphNode = {
        id: "test-node",
        path: "test.md",
        title: "Test",
        label: "Test",
        isArchived: false,
        properties: {
          [RDF_TYPE_PREDICATES.RDF_TYPE]: "http://example.org/CustomType",
        },
      };

      const typeInfo = registry.resolveNodeType(node);

      expect(typeInfo.types).toContain("http://example.org/CustomType");
    });
  });

  describe("resolveEdgeType", () => {
    beforeEach(() => {
      registry.registerEdgeType({
        uri: "http://example.org/parent",
        label: "parent",
        source: "custom",
        style: { color: "#0000ff", width: 2 },
        priority: 1,
      });
    });

    it("should resolve type from predicate", () => {
      const edge: GraphEdge = {
        id: "edge-1",
        source: "node-1",
        target: "node-2",
        type: "semantic",
        predicate: "http://example.org/parent",
      };

      const typeInfo = registry.resolveEdgeType(edge);

      expect(typeInfo.primaryType).toBe("http://example.org/parent");
      expect(typeInfo.resolvedStyle.color).toBe("#0000ff");
      expect(typeInfo.resolvedStyle.width).toBe(2);
    });

    it("should fall back to edge type when no predicate", () => {
      const edge: GraphEdge = {
        id: "edge-1",
        source: "node-1",
        target: "node-2",
        type: "hierarchy",
      };

      const typeInfo = registry.resolveEdgeType(edge);

      expect(typeInfo.primaryType).toBe("hierarchy");
    });
  });

  describe("style resolution", () => {
    it("should merge styles from multiple types by priority", () => {
      registry.registerNodeType({
        uri: "http://example.org/Base",
        label: "Base",
        source: "custom",
        style: { color: "#ff0000", size: 20, shape: "circle" },
        priority: 1,
      });

      registry.registerNodeType({
        uri: "http://example.org/Derived",
        label: "Derived",
        source: "custom",
        style: { color: "#00ff00", borderWidth: 3 },
        priority: 2,
      });

      const style = registry.resolveNodeStyle([
        "http://example.org/Base",
        "http://example.org/Derived",
      ]);

      // Higher priority color wins
      expect(style.color).toBe("#00ff00");
      // Other properties from both are merged
      expect(style.size).toBe(20);
      expect(style.borderWidth).toBe(3);
    });

    it("should use default style when no types match", () => {
      const style = registry.resolveNodeStyle(["http://example.org/Unknown"]);

      // Should fall back to default
      expect(style.color).toBe(DEFAULT_NODE_STYLE.color);
      expect(style.shape).toBe(DEFAULT_NODE_STYLE.shape);
    });
  });

  describe("filterNodes", () => {
    const nodes: GraphNode[] = [
      { id: "1", path: "1.md", title: "Task 1", label: "T1", assetClass: "ems__Task", isArchived: false },
      { id: "2", path: "2.md", title: "Project 1", label: "P1", assetClass: "ems__Project", isArchived: false },
      { id: "3", path: "3.md", title: "Task 2", label: "T2", assetClass: "ems__Task", isArchived: false },
      { id: "4", path: "4.md", title: "Area 1", label: "A1", assetClass: "ems__Area", isArchived: false },
    ];

    beforeEach(() => {
      registry.registerNodeType({
        uri: "ems__Task",
        label: "Task",
        source: "custom",
        style: {},
        priority: 1,
      });
      registry.registerNodeType({
        uri: "ems__Project",
        label: "Project",
        source: "custom",
        style: {},
        priority: 1,
      });
      registry.registerNodeType({
        uri: "ems__Area",
        label: "Area",
        source: "custom",
        style: {},
        priority: 1,
      });
    });

    it("should include only specified types", () => {
      const filter: TypeFilter = {
        includeNodeTypes: ["ems__Task"],
      };

      const filtered = registry.filterNodes(nodes, filter);

      expect(filtered).toHaveLength(2);
      expect(filtered.every(n => n.assetClass === "ems__Task")).toBe(true);
    });

    it("should exclude specified types", () => {
      const filter: TypeFilter = {
        excludeNodeTypes: ["ems__Task"],
      };

      const filtered = registry.filterNodes(nodes, filter);

      expect(filtered).toHaveLength(2);
      expect(filtered.some(n => n.assetClass === "ems__Task")).toBe(false);
    });

    it("should combine include and exclude", () => {
      const filter: TypeFilter = {
        includeNodeTypes: ["ems__Task", "ems__Project"],
        excludeNodeTypes: ["ems__Project"],
      };

      const filtered = registry.filterNodes(nodes, filter);

      expect(filtered).toHaveLength(2);
      expect(filtered.every(n => n.assetClass === "ems__Task")).toBe(true);
    });

    it("should exclude deprecated types by default", () => {
      registry.registerNodeType({
        uri: "ems__OldTask",
        label: "Old Task",
        source: "custom",
        style: {},
        priority: 1,
        deprecated: true,
      });

      const nodesWithDeprecated: GraphNode[] = [
        ...nodes,
        { id: "5", path: "5.md", title: "Old", label: "O", assetClass: "ems__OldTask", isArchived: false },
      ];

      const filtered = registry.filterNodes(nodesWithDeprecated, {});

      expect(filtered.some(n => n.assetClass === "ems__OldTask")).toBe(false);
    });

    it("should include deprecated types when specified", () => {
      registry.registerNodeType({
        uri: "ems__OldTask",
        label: "Old Task",
        source: "custom",
        style: {},
        priority: 1,
        deprecated: true,
      });

      const nodesWithDeprecated: GraphNode[] = [
        { id: "5", path: "5.md", title: "Old", label: "O", assetClass: "ems__OldTask", isArchived: false },
      ];

      const filtered = registry.filterNodes(nodesWithDeprecated, {
        includeDeprecated: true,
      });

      expect(filtered).toHaveLength(1);
    });
  });

  describe("filterEdges", () => {
    const edges: GraphEdge[] = [
      { id: "e1", source: "1", target: "2", type: "hierarchy", predicate: "http://ex.org/parent" },
      { id: "e2", source: "2", target: "3", type: "reference", predicate: "http://ex.org/refs" },
      { id: "e3", source: "1", target: "3", type: "hierarchy", predicate: "http://ex.org/parent" },
    ];

    it("should include only specified types", () => {
      const filter: TypeFilter = {
        includeEdgeTypes: ["http://ex.org/parent"],
      };

      const filtered = registry.filterEdges(edges, filter);

      expect(filtered).toHaveLength(2);
      expect(filtered.every(e => e.predicate === "http://ex.org/parent")).toBe(true);
    });

    it("should exclude specified types", () => {
      const filter: TypeFilter = {
        excludeEdgeTypes: ["http://ex.org/parent"],
      };

      const filtered = registry.filterEdges(edges, filter);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].predicate).toBe("http://ex.org/refs");
    });
  });

  describe("groupNodesByType", () => {
    const nodes: GraphNode[] = [
      { id: "1", path: "1.md", title: "Task 1", label: "T1", assetClass: "ems__Task", isArchived: false },
      { id: "2", path: "2.md", title: "Task 2", label: "T2", assetClass: "ems__Task", isArchived: false },
      { id: "3", path: "3.md", title: "Project 1", label: "P1", assetClass: "ems__Project", isArchived: false },
      { id: "4", path: "4.md", title: "Area 1", label: "A1", assetClass: "ems__Area", isArchived: false },
    ];

    const edges: GraphEdge[] = [
      { id: "e1", source: "1", target: "2", type: "reference" },
      { id: "e2", source: "1", target: "3", type: "hierarchy" },
      { id: "e3", source: "3", target: "4", type: "hierarchy" },
    ];

    it("should group nodes by type", () => {
      const groups = registry.groupNodesByType(nodes, edges);

      expect(groups.length).toBe(3);

      const taskGroup = groups.find(g => g.id === "ems__Task");
      expect(taskGroup?.nodeIds).toHaveLength(2);
      expect(taskGroup?.nodeIds).toContain("1");
      expect(taskGroup?.nodeIds).toContain("2");

      const projectGroup = groups.find(g => g.id === "ems__Project");
      expect(projectGroup?.nodeIds).toHaveLength(1);
    });

    it("should calculate edge statistics", () => {
      const groups = registry.groupNodesByType(nodes, edges);

      const taskGroup = groups.find(g => g.id === "ems__Task");
      expect(taskGroup?.stats.internalEdgeCount).toBe(1); // e1: 1->2
      expect(taskGroup?.stats.externalEdgeCount).toBe(1); // e2: 1->3
    });

    it("should limit number of groups", () => {
      const manyNodes: GraphNode[] = [];
      for (let i = 0; i < 50; i++) {
        manyNodes.push({
          id: `${i}`,
          path: `${i}.md`,
          title: `Node ${i}`,
          label: `N${i}`,
          assetClass: `type_${i % 30}`, // 30 different types
          isArchived: false,
        });
      }

      const groups = registry.groupNodesByType(manyNodes, [], { maxGroups: 5 });

      expect(groups.length).toBe(5);
      expect(groups.some(g => g.id === "other")).toBe(true);
    });

    it("should support custom grouping function", () => {
      const grouping: TypeGrouping = {
        customGroupFn: (types) => types[0].startsWith("ems__") ? "ems" : "other",
      };

      const groups = registry.groupNodesByType(nodes, edges, grouping);

      expect(groups.length).toBe(1); // All are ems__
      expect(groups[0].id).toBe("ems");
      expect(groups[0].nodeIds).toHaveLength(4);
    });

    it("should assign colors to groups", () => {
      const groups = registry.groupNodesByType(nodes, edges);

      for (const group of groups) {
        expect(group.color).toBeDefined();
        // Allow decimal values in hsl, e.g., "hsl(137.5, 70%, 50%)"
        expect(group.color).toMatch(/^hsl\([\d.]+, 70%, 50%\)$/);
      }
    });
  });

  describe("validateTypes", () => {
    const nodes: GraphNode[] = [
      { id: "1", path: "1.md", title: "Task", label: "T", assetClass: "ems__Task", isArchived: false },
      { id: "2", path: "2.md", title: "Unknown", label: "U", isArchived: false },
    ];

    const edges: GraphEdge[] = [
      { id: "e1", source: "1", target: "2", type: "semantic", predicate: "http://ex.org/link" },
    ];

    beforeEach(() => {
      registry.registerNodeType({
        uri: "ems__Task",
        label: "Task",
        source: "custom",
        style: {},
        priority: 1,
      });
    });

    it("should validate nodes and return result", () => {
      const result = registry.validateTypes(nodes, edges);

      expect(result.valid).toBe(true); // No errors (warnings don't fail)
      expect(result.warnings.length).toBeGreaterThan(0); // Has warnings
    });

    it("should warn about unregistered types", () => {
      const result = registry.validateTypes(nodes, edges);

      const warning = result.warnings.find(w => w.code === "MISSING_NODE_TYPE");
      expect(warning).toBeDefined();
      expect(warning?.elementId).toBe("2");
    });

    it("should check domain constraints", () => {
      registry.registerEdgeType({
        uri: "http://ex.org/taskLink",
        label: "task link",
        domain: ["ems__Project"], // Only projects can be sources
        source: "custom",
        style: {},
        priority: 1,
      });

      registry.registerNodeType({
        uri: "ems__Project",
        label: "Project",
        source: "custom",
        style: {},
        priority: 1,
      });

      const edgesWithConstraint: GraphEdge[] = [
        { id: "e1", source: "1", target: "2", type: "semantic", predicate: "http://ex.org/taskLink" },
      ];

      const result = registry.validateTypes(nodes, edgesWithConstraint);

      expect(result.valid).toBe(false);
      const error = result.errors.find(e => e.code === "DOMAIN_VIOLATION");
      expect(error).toBeDefined();
    });

    it("should check range constraints", () => {
      registry.registerEdgeType({
        uri: "http://ex.org/hasTarget",
        label: "has target",
        range: ["ems__Project"], // Only projects can be targets
        source: "custom",
        style: {},
        priority: 1,
      });

      registry.registerNodeType({
        uri: "ems__Project",
        label: "Project",
        source: "custom",
        style: {},
        priority: 1,
      });

      const edgesWithConstraint: GraphEdge[] = [
        { id: "e1", source: "1", target: "2", type: "semantic", predicate: "http://ex.org/hasTarget" },
      ];

      const result = registry.validateTypes(nodes, edgesWithConstraint);

      // Node 2 has no assetClass, so it won't match ems__Project
      expect(result.valid).toBe(false);
      const error = result.errors.find(e => e.code === "RANGE_VIOLATION");
      expect(error).toBeDefined();
    });

    it("should warn about deprecated types", () => {
      registry.registerNodeType({
        uri: "ems__OldType",
        label: "Old Type",
        source: "custom",
        style: {},
        priority: 1,
        deprecated: true,
      });

      const nodesWithDeprecated: GraphNode[] = [
        { id: "1", path: "1.md", title: "Old", label: "O", assetClass: "ems__OldType", isArchived: false },
      ];

      const result = registry.validateTypes(nodesWithDeprecated, []);

      const warning = result.warnings.find(w => w.code === "DEPRECATED_NODE_TYPE");
      expect(warning).toBeDefined();
    });
  });

  describe("clear", () => {
    it("should clear all registered types", () => {
      registry.registerNodeType({
        uri: "test",
        label: "Test",
        source: "custom",
        style: {},
        priority: 1,
      });

      registry.clear();

      expect(registry.getAllNodeTypes()).toHaveLength(0);
      expect(registry.getAllEdgeTypes()).toHaveLength(0);
    });

    it("should re-register built-in types when enabled", () => {
      const registryWithBuiltIn = new TypeRegistry(null, { includeBuiltInStyles: true });
      const initialCount = registryWithBuiltIn.getAllNodeTypes().length;

      registryWithBuiltIn.registerNodeType({
        uri: "custom",
        label: "Custom",
        source: "custom",
        style: {},
        priority: 1,
      });

      registryWithBuiltIn.clear();

      expect(registryWithBuiltIn.getAllNodeTypes().length).toBe(initialCount);
    });
  });

  describe("subscribe", () => {
    it("should call callback on events", () => {
      const events: string[] = [];
      registry.subscribe(event => events.push(event.type));

      registry.registerNodeType({
        uri: "test",
        label: "Test",
        source: "custom",
        style: {},
        priority: 1,
      });

      expect(events).toContain("type-added");
    });

    it("should allow unsubscribing", () => {
      const events: string[] = [];
      const unsubscribe = registry.subscribe(event => events.push(event.type));

      registry.registerNodeType({
        uri: "test1",
        label: "Test 1",
        source: "custom",
        style: {},
        priority: 1,
      });

      unsubscribe();

      registry.registerNodeType({
        uri: "test2",
        label: "Test 2",
        source: "custom",
        style: {},
        priority: 1,
      });

      expect(events).toHaveLength(1);
    });

    it("should continue even if callback throws", () => {
      const events: string[] = [];

      registry.subscribe(() => {
        throw new Error("Test error");
      });
      registry.subscribe(event => events.push(event.type));

      // Should not throw
      registry.registerNodeType({
        uri: "test",
        label: "Test",
        source: "custom",
        style: {},
        priority: 1,
      });

      expect(events).toContain("type-added");
    });
  });
});

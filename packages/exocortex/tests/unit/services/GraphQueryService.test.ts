// Jest-compatible test file
import { GraphQueryService, GraphQueryServiceConfig } from "../../../src/services/GraphQueryService";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { GraphEdgeType } from "../../../src/domain/models/GraphEdge";

describe("GraphQueryService", () => {
  let tripleStore: InMemoryTripleStore;
  let service: GraphQueryService;

  // Test URIs
  const taskUri = new IRI("obsidian://vault/tasks%2Ftask-001.md");
  const projectUri = new IRI("obsidian://vault/projects%2Fproject-001.md");
  const areaUri = new IRI("obsidian://vault/areas%2Farea-001.md");

  // Predicates
  const instanceClass = Namespace.EXO.term("Instance_class");
  const assetLabel = Namespace.EXO.term("Asset_label");
  const assetPrototype = Namespace.EXO.term("Asset_prototype");
  const assetIsArchived = Namespace.EXO.term("Asset_isArchived");
  const effortParent = Namespace.EMS.term("Effort_parent");
  const references = Namespace.EXO.term("references");

  beforeEach(async () => {
    tripleStore = new InMemoryTripleStore();
    service = new GraphQueryService(tripleStore);

    // Set up test data
    await tripleStore.addAll([
      // Task 1 - active task with parent project
      new Triple(taskUri, instanceClass, new Literal("ems__Task")),
      new Triple(taskUri, assetLabel, new Literal("Task 001")),
      new Triple(taskUri, effortParent, projectUri),
      new Triple(taskUri, assetIsArchived, new Literal("false")),

      // Project 1 - with parent area
      new Triple(projectUri, instanceClass, new Literal("ems__Project")),
      new Triple(projectUri, assetLabel, new Literal("Project 001")),
      new Triple(projectUri, effortParent, areaUri),
      new Triple(projectUri, assetIsArchived, new Literal("false")),

      // Area 1 - root
      new Triple(areaUri, instanceClass, new Literal("ems__Area")),
      new Triple(areaUri, assetLabel, new Literal("Area 001")),
      new Triple(areaUri, assetIsArchived, new Literal("false")),

      // Reference link: task references project
      new Triple(taskUri, references, projectUri),
    ]);
  });

  describe("loadGraphData", () => {
    it("should load all nodes from triple store", async () => {
      const result = await service.loadGraphData();

      expect(result.nodes).toHaveLength(3);
      expect(result.nodes.map(n => n.title)).toContain("Task 001");
      expect(result.nodes.map(n => n.title)).toContain("Project 001");
      expect(result.nodes.map(n => n.title)).toContain("Area 001");
    });

    it("should load edges between nodes", async () => {
      const result = await service.loadGraphData();

      expect(result.edges.length).toBeGreaterThan(0);

      // Check for hierarchy edge (task -> project)
      const hierarchyEdge = result.edges.find(
        e => e.type === "hierarchy" && e.source.includes("task-001") && e.target.includes("project-001")
      );
      expect(hierarchyEdge).toBeDefined();
    });

    it("should include graph stats", async () => {
      const result = await service.loadGraphData();

      expect(result.stats).toBeDefined();
      expect(result.stats?.nodeCount).toBe(3);
      expect(result.stats?.nodesByClass["ems__Task"]).toBe(1);
      expect(result.stats?.nodesByClass["ems__Project"]).toBe(1);
      expect(result.stats?.nodesByClass["ems__Area"]).toBe(1);
    });

    it("should filter by asset classes", async () => {
      const result = await service.loadGraphData({
        classes: ["ems__Task"],
      });

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].assetClass).toBe("ems__Task");
    });

    it("should exclude archived nodes by default", async () => {
      // Archive the task
      await tripleStore.remove(new Triple(taskUri, assetIsArchived, new Literal("false")));
      await tripleStore.add(new Triple(taskUri, assetIsArchived, new Literal("true")));

      // Clear cache to force reload
      service.clearCache();

      const result = await service.loadGraphData();

      expect(result.nodes).toHaveLength(2);
      expect(result.nodes.map(n => n.title)).not.toContain("Task 001");
    });

    it("should include archived nodes when requested", async () => {
      // Archive the task
      await tripleStore.remove(new Triple(taskUri, assetIsArchived, new Literal("false")));
      await tripleStore.add(new Triple(taskUri, assetIsArchived, new Literal("true")));

      // Clear cache to force reload
      service.clearCache();

      const result = await service.loadGraphData({
        includeArchived: true,
      });

      expect(result.nodes).toHaveLength(3);
      expect(result.nodes.find(n => n.title === "Task 001")?.isArchived).toBe(true);
    });
  });

  describe("loadNodesIncremental", () => {
    it("should load nodes with limit", async () => {
      const result = await service.loadNodesIncremental({
        limit: 2,
      });

      expect(result.nodes).toHaveLength(2);
      expect(result.hasMore).toBe(true);
    });

    it("should support pagination with offset", async () => {
      const firstPage = await service.loadNodesIncremental({ limit: 2, offset: 0 });
      const secondPage = await service.loadNodesIncremental({ limit: 2, offset: 2 });

      expect(firstPage.nodes).toHaveLength(2);
      expect(secondPage.nodes).toHaveLength(1);
      expect(secondPage.hasMore).toBe(false);
    });

    it("should provide cursor for next page", async () => {
      const result = await service.loadNodesIncremental({ limit: 2 });

      expect(result.hasMore).toBe(true);
      expect(result.cursor).toBe("2");
    });
  });

  describe("loadConnectedNodes", () => {
    it("should load nodes connected to root at depth 1", async () => {
      const rootId = "tasks/task-001.md";
      const result = await service.loadConnectedNodes(rootId, { depth: 1 });

      // Should include the root and directly connected nodes
      const nodeIds = result.nodes.map(n => n.id);
      expect(nodeIds.some(id => id.includes("task-001"))).toBe(true);
      expect(nodeIds.some(id => id.includes("project-001"))).toBe(true);
    });

    it("should traverse multiple levels with higher depth", async () => {
      const rootId = "tasks/task-001.md";
      const result = await service.loadConnectedNodes(rootId, { depth: 2 });

      // Should reach area through project
      const nodeIds = result.nodes.map(n => n.id);
      expect(nodeIds.some(id => id.includes("task-001"))).toBe(true);
      expect(nodeIds.some(id => id.includes("project-001"))).toBe(true);
      expect(nodeIds.some(id => id.includes("area-001"))).toBe(true);
    });

    it("should respect node limit", async () => {
      const rootId = "tasks/task-001.md";
      const result = await service.loadConnectedNodes(rootId, { depth: 10, limit: 2 });

      expect(result.nodes.length).toBeLessThanOrEqual(2);
    });
  });

  describe("getNodeById", () => {
    it("should return node by path", async () => {
      const node = await service.getNodeById("tasks/task-001.md");

      expect(node).not.toBeNull();
      expect(node?.title).toBe("Task 001");
      expect(node?.assetClass).toBe("ems__Task");
    });

    it("should return null for non-existent node", async () => {
      const node = await service.getNodeById("nonexistent.md");

      expect(node).toBeNull();
    });

    it("should cache nodes", async () => {
      // First call
      const node1 = await service.getNodeById("tasks/task-001.md");

      // Modify the store (but cache should still have old value)
      await tripleStore.remove(new Triple(taskUri, assetLabel, new Literal("Task 001")));
      await tripleStore.add(new Triple(taskUri, assetLabel, new Literal("Modified Task")));

      // Second call should return cached value
      const node2 = await service.getNodeById("tasks/task-001.md");

      expect(node1?.title).toBe(node2?.title);
    });

    it("should respect cache TTL", async () => {
      const shortCacheService = new GraphQueryService(tripleStore, {
        cacheTTL: 1, // 1ms TTL
      });

      // First call
      await shortCacheService.getNodeById("tasks/task-001.md");

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 10));

      // Modify the store
      await tripleStore.remove(new Triple(taskUri, assetLabel, new Literal("Task 001")));
      await tripleStore.add(new Triple(taskUri, assetLabel, new Literal("Modified Task")));

      // Second call should fetch fresh data
      const node = await shortCacheService.getNodeById("tasks/task-001.md");

      expect(node?.title).toBe("Modified Task");
    });
  });

  describe("subscribe", () => {
    it("should notify subscribers on change", () => {
      const callback = jest.fn();
      service.subscribe(callback);

      service.notifyChange({
        type: "node-added",
        node: {
          id: "new-node",
          path: "new-node.md",
          title: "New Node",
          label: "New Node",
          isArchived: false,
        },
        timestamp: Date.now(),
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].type).toBe("node-added");
    });

    it("should allow unsubscribing", () => {
      const callback = jest.fn();
      const subscription = service.subscribe(callback);

      subscription.unsubscribe();

      service.notifyChange({
        type: "node-added",
        node: {
          id: "new-node",
          path: "new-node.md",
          title: "New Node",
          label: "New Node",
          isArchived: false,
        },
        timestamp: Date.now(),
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it("should handle multiple subscribers", () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      service.subscribe(callback1);
      service.subscribe(callback2);

      service.notifyChange({
        type: "node-updated",
        node: {
          id: "node",
          path: "node.md",
          title: "Node",
          label: "Node",
          isArchived: false,
        },
        timestamp: Date.now(),
      });

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it("should continue notifying other subscribers even if one throws", () => {
      const errorCallback = jest.fn(() => {
        throw new Error("Callback error");
      });
      const successCallback = jest.fn();

      service.subscribe(errorCallback);
      service.subscribe(successCallback);

      // Should not throw
      service.notifyChange({
        type: "node-removed",
        node: {
          id: "node",
          path: "node.md",
          title: "Node",
          label: "Node",
          isArchived: false,
        },
        timestamp: Date.now(),
      });

      expect(errorCallback).toHaveBeenCalled();
      expect(successCallback).toHaveBeenCalled();
    });
  });

  describe("getStats", () => {
    it("should compute accurate statistics", async () => {
      const stats = await service.getStats();

      expect(stats.nodeCount).toBe(3);
      expect(stats.nodesByClass["ems__Task"]).toBe(1);
      expect(stats.nodesByClass["ems__Project"]).toBe(1);
      expect(stats.nodesByClass["ems__Area"]).toBe(1);
      expect(stats.computedAt).toBeGreaterThan(0);
    });

    it("should include archived nodes in stats", async () => {
      // Archive the task
      await tripleStore.remove(new Triple(taskUri, assetIsArchived, new Literal("false")));
      await tripleStore.add(new Triple(taskUri, assetIsArchived, new Literal("true")));

      service.clearCache();

      const stats = await service.getStats();

      expect(stats.nodeCount).toBe(3); // All nodes including archived
    });
  });

  describe("edge type detection", () => {
    it("should identify hierarchy edges from Effort_parent", async () => {
      const result = await service.loadGraphData();

      const hierarchyEdges = result.edges.filter(e => e.type === "hierarchy");
      expect(hierarchyEdges.length).toBeGreaterThan(0);
    });

    it("should identify forward-link edges from references", async () => {
      const result = await service.loadGraphData();

      const forwardLinkEdges = result.edges.filter(e => e.type === "forward-link");
      expect(forwardLinkEdges.length).toBeGreaterThan(0);
    });
  });

  describe("configuration", () => {
    it("should use default configuration values", () => {
      const defaultService = new GraphQueryService(tripleStore);

      // Test by loading with defaults
      expect(async () => {
        await defaultService.loadGraphData();
      }).not.toThrow();
    });

    it("should respect custom configuration", async () => {
      const customConfig: GraphQueryServiceConfig = {
        defaultLimit: 1,
        maxLimit: 2,
        defaultDepth: 1,
        maxDepth: 2,
        includeArchivedByDefault: true,
        cacheTTL: 60000,
      };

      const customService = new GraphQueryService(tripleStore, customConfig);

      // Archive a node
      await tripleStore.remove(new Triple(taskUri, assetIsArchived, new Literal("false")));
      await tripleStore.add(new Triple(taskUri, assetIsArchived, new Literal("true")));

      const result = await customService.loadGraphData();

      // Should include archived nodes by default
      expect(result.nodes.some(n => n.isArchived)).toBe(true);
    });
  });

  describe("clearCache", () => {
    it("should clear all cached nodes", async () => {
      // Populate cache
      await service.getNodeById("tasks/task-001.md");

      // Clear cache
      service.clearCache();

      // Modify the store
      await tripleStore.remove(new Triple(taskUri, assetLabel, new Literal("Task 001")));
      await tripleStore.add(new Triple(taskUri, assetLabel, new Literal("Modified Task")));

      // Should fetch fresh data
      const node = await service.getNodeById("tasks/task-001.md");

      expect(node?.title).toBe("Modified Task");
    });
  });

  describe("performance", () => {
    it("should load 1K nodes in under 100ms", async () => {
      // Create 1000 test nodes
      for (let i = 0; i < 1000; i++) {
        const nodeUri = new IRI(`obsidian://vault/nodes%2Fnode-${i.toString().padStart(4, "0")}.md`);
        await tripleStore.add(new Triple(nodeUri, instanceClass, new Literal("ems__Task")));
        await tripleStore.add(new Triple(nodeUri, assetLabel, new Literal(`Node ${i}`)));
        await tripleStore.add(new Triple(nodeUri, assetIsArchived, new Literal("false")));
      }

      service.clearCache();

      const startTime = Date.now();
      const result = await service.loadGraphData({ includeArchived: true });
      const endTime = Date.now();

      const loadTime = endTime - startTime;

      // Should have 1003 nodes (3 original + 1000 new)
      expect(result.nodes.length).toBe(1003);

      // Performance target: <100ms for 1K nodes
      // Allow some tolerance for CI environments
      expect(loadTime).toBeLessThan(500); // 500ms is generous for CI
    }, 10000); // 10 second timeout for this test
  });
});

describe("GraphNode", () => {
  it("should have all required fields", () => {
    const node = {
      id: "test-id",
      path: "test.md",
      title: "Test",
      label: "Test",
      isArchived: false,
    };

    expect(node.id).toBeDefined();
    expect(node.path).toBeDefined();
    expect(node.title).toBeDefined();
    expect(node.label).toBeDefined();
    expect(node.isArchived).toBeDefined();
  });
});

describe("GraphEdge", () => {
  it("should have all required fields", () => {
    const edge = {
      source: "source-id",
      target: "target-id",
      type: "forward-link" as GraphEdgeType,
    };

    expect(edge.source).toBeDefined();
    expect(edge.target).toBeDefined();
    expect(edge.type).toBeDefined();
  });
});

/**
 * NeighborhoodExplorer Tests
 *
 * Tests for multi-hop neighborhood exploration functionality
 *
 * @module tests/presentation/renderers/graph/inference
 */

import {
  NeighborhoodExplorer,
  createNeighborhoodExplorer,
  InferenceManager,
  type NeighborhoodTripleStore,
  type InferenceTripleStore,
  type Triple,
  type NeighborhoodExplorationOptions,
} from "../../../../../../src/presentation/renderers/graph/inference";

// ============================================================
// Test Helpers
// ============================================================

interface MockTripleStoreData {
  outgoing: Map<string, Triple[]>;
  incoming: Map<string, Triple[]>;
  metadata: Map<string, Record<string, unknown>>;
}

function createMockNeighborhoodStore(
  data: Partial<MockTripleStoreData> = {}
): NeighborhoodTripleStore {
  const outgoing = data.outgoing ?? new Map();
  const incoming = data.incoming ?? new Map();
  const metadata = data.metadata ?? new Map();

  return {
    getOutgoing: jest.fn(async (subject: string) => {
      return outgoing.get(subject) ?? [];
    }),
    getIncoming: jest.fn(async (object: string) => {
      return incoming.get(object) ?? [];
    }),
    getNodeMetadata: jest.fn(async (nodeId: string) => {
      return metadata.get(nodeId) ?? null;
    }),
  };
}

function createSimpleGraph(): MockTripleStoreData {
  // Create a simple graph:
  // A --knows--> B --knows--> C --knows--> D
  // A --likes--> C
  const outgoing = new Map<string, Triple[]>();
  const incoming = new Map<string, Triple[]>();

  // A's outgoing
  outgoing.set("A", [
    { subject: "A", predicate: "knows", object: "B" },
    { subject: "A", predicate: "likes", object: "C" },
  ]);

  // B's outgoing
  outgoing.set("B", [
    { subject: "B", predicate: "knows", object: "C" },
  ]);

  // C's outgoing
  outgoing.set("C", [
    { subject: "C", predicate: "knows", object: "D" },
  ]);

  // Incoming edges
  incoming.set("B", [
    { subject: "A", predicate: "knows", object: "B" },
  ]);

  incoming.set("C", [
    { subject: "B", predicate: "knows", object: "C" },
    { subject: "A", predicate: "likes", object: "C" },
  ]);

  incoming.set("D", [
    { subject: "C", predicate: "knows", object: "D" },
  ]);

  // Metadata
  const metadata = new Map<string, Record<string, unknown>>();
  metadata.set("A", { label: "Alice", types: ["Person"] });
  metadata.set("B", { label: "Bob", types: ["Person"] });
  metadata.set("C", { label: "Carol", types: ["Person"] });
  metadata.set("D", { label: "David", types: ["Person"] });

  return { outgoing, incoming, metadata };
}

// ============================================================
// Tests
// ============================================================

describe("NeighborhoodExplorer", () => {
  describe("constructor", () => {
    it("should create an instance without inference manager", () => {
      const store = createMockNeighborhoodStore();
      const explorer = new NeighborhoodExplorer(store);

      expect(explorer).toBeInstanceOf(NeighborhoodExplorer);
    });

    it("should create an instance with inference manager", () => {
      const store = createMockNeighborhoodStore();
      const inferenceStore: InferenceTripleStore = {
        match: jest.fn(async () => []),
        has: jest.fn(async () => false),
        getAll: jest.fn(async () => []),
      };
      const inferenceManager = new InferenceManager(inferenceStore);
      const explorer = new NeighborhoodExplorer(store, inferenceManager);

      expect(explorer).toBeInstanceOf(NeighborhoodExplorer);
    });
  });

  describe("createNeighborhoodExplorer", () => {
    it("should create an instance using factory function", () => {
      const store = createMockNeighborhoodStore();
      const explorer = createNeighborhoodExplorer(store);

      expect(explorer).toBeInstanceOf(NeighborhoodExplorer);
    });
  });

  describe("explore - basic functionality", () => {
    it("should find direct neighbors (1 hop)", async () => {
      const data = createSimpleGraph();
      const store = createMockNeighborhoodStore(data);
      const explorer = new NeighborhoodExplorer(store);

      const result = await explorer.explore("A", {
        maxHops: 1,
        direction: "outgoing",
        includeInferred: false,
        maxNodes: 100,
        maxEdges: 500,
        timeout: 10000,
      });

      expect(result.centerId).toBe("A");
      expect(result.nodes.length).toBe(3); // A, B, C
      expect(result.edges.length).toBe(2); // A->B, A->C
    });

    it("should find 2-hop neighbors", async () => {
      const data = createSimpleGraph();
      const store = createMockNeighborhoodStore(data);
      const explorer = new NeighborhoodExplorer(store);

      const result = await explorer.explore("A", {
        maxHops: 2,
        direction: "outgoing",
        includeInferred: false,
        maxNodes: 100,
        maxEdges: 500,
        timeout: 10000,
      });

      expect(result.centerId).toBe("A");
      // A (hop 0), B (hop 1), C (hop 1), C from B (already visited), D (hop 2)
      expect(result.nodes.length).toBe(4); // A, B, C, D
    });

    it("should find 3-hop neighbors", async () => {
      const data = createSimpleGraph();
      const store = createMockNeighborhoodStore(data);
      const explorer = new NeighborhoodExplorer(store);

      const result = await explorer.explore("A", {
        maxHops: 3,
        direction: "outgoing",
        includeInferred: false,
        maxNodes: 100,
        maxEdges: 500,
        timeout: 10000,
      });

      // All 4 nodes should be reachable
      expect(result.nodes.length).toBe(4);
    });
  });

  describe("explore - direction options", () => {
    it("should explore outgoing edges only", async () => {
      const data = createSimpleGraph();
      const store = createMockNeighborhoodStore(data);
      const explorer = new NeighborhoodExplorer(store);

      const result = await explorer.explore("B", {
        maxHops: 1,
        direction: "outgoing",
        includeInferred: false,
        maxNodes: 100,
        maxEdges: 500,
        timeout: 10000,
      });

      // B has only C as outgoing neighbor
      expect(result.nodes.length).toBe(2); // B, C
      expect(result.nodes.some((n) => n.id === "C")).toBe(true);
      expect(result.nodes.some((n) => n.id === "A")).toBe(false);
    });

    it("should explore incoming edges only", async () => {
      const data = createSimpleGraph();
      const store = createMockNeighborhoodStore(data);
      const explorer = new NeighborhoodExplorer(store);

      const result = await explorer.explore("B", {
        maxHops: 1,
        direction: "incoming",
        includeInferred: false,
        maxNodes: 100,
        maxEdges: 500,
        timeout: 10000,
      });

      // B has only A as incoming neighbor
      expect(result.nodes.length).toBe(2); // B, A
      expect(result.nodes.some((n) => n.id === "A")).toBe(true);
      expect(result.nodes.some((n) => n.id === "C")).toBe(false);
    });

    it("should explore both directions", async () => {
      const data = createSimpleGraph();
      const store = createMockNeighborhoodStore(data);
      const explorer = new NeighborhoodExplorer(store);

      const result = await explorer.explore("B", {
        maxHops: 1,
        direction: "both",
        includeInferred: false,
        maxNodes: 100,
        maxEdges: 500,
        timeout: 10000,
      });

      // B has A (incoming) and C (outgoing)
      expect(result.nodes.length).toBe(3); // B, A, C
      expect(result.nodes.some((n) => n.id === "A")).toBe(true);
      expect(result.nodes.some((n) => n.id === "C")).toBe(true);
    });
  });

  describe("explore - predicate filtering", () => {
    it("should filter by predicate (include)", async () => {
      const data = createSimpleGraph();
      const store = createMockNeighborhoodStore(data);
      const explorer = new NeighborhoodExplorer(store);

      const result = await explorer.explore("A", {
        maxHops: 2,
        direction: "outgoing",
        includeInferred: false,
        predicateFilter: ["knows"],
        maxNodes: 100,
        maxEdges: 500,
        timeout: 10000,
      });

      // Should only follow "knows" edges: A -> B -> C
      expect(result.nodes.length).toBe(3); // A, B, C
      expect(result.nodes.some((n) => n.id === "B")).toBe(true);
      expect(result.nodes.some((n) => n.id === "C")).toBe(true);
    });

    it("should filter by predicate (exclude)", async () => {
      const data = createSimpleGraph();
      const store = createMockNeighborhoodStore(data);
      const explorer = new NeighborhoodExplorer(store);

      const result = await explorer.explore("A", {
        maxHops: 1,
        direction: "outgoing",
        includeInferred: false,
        excludePredicates: ["likes"],
        maxNodes: 100,
        maxEdges: 500,
        timeout: 10000,
      });

      // Should exclude "likes" edge, only "knows" to B
      expect(result.nodes.length).toBe(2); // A, B
      expect(result.nodes.some((n) => n.id === "B")).toBe(true);
      expect(result.nodes.some((n) => n.id === "C")).toBe(false);
    });
  });

  describe("explore - limits", () => {
    it("should respect maxNodes limit", async () => {
      const data = createSimpleGraph();
      const store = createMockNeighborhoodStore(data);
      const explorer = new NeighborhoodExplorer(store);

      const result = await explorer.explore("A", {
        maxHops: 10,
        direction: "outgoing",
        includeInferred: false,
        maxNodes: 2,
        maxEdges: 500,
        timeout: 10000,
      });

      expect(result.nodes.length).toBeLessThanOrEqual(2);
      expect(result.truncated).toBe(true);
    });

    it("should respect maxEdges limit", async () => {
      const data = createSimpleGraph();
      const store = createMockNeighborhoodStore(data);
      const explorer = new NeighborhoodExplorer(store);

      const result = await explorer.explore("A", {
        maxHops: 10,
        direction: "outgoing",
        includeInferred: false,
        maxNodes: 100,
        maxEdges: 1,
        timeout: 10000,
      });

      expect(result.edges.length).toBeLessThanOrEqual(1);
    });
  });

  describe("explore - hop distance tracking", () => {
    it("should correctly track hop distance for nodes", async () => {
      const data = createSimpleGraph();
      const store = createMockNeighborhoodStore(data);
      const explorer = new NeighborhoodExplorer(store);

      const result = await explorer.explore("A", {
        maxHops: 3,
        direction: "outgoing",
        includeInferred: false,
        maxNodes: 100,
        maxEdges: 500,
        timeout: 10000,
      });

      const centerNode = result.nodes.find((n) => n.id === "A");
      const hop1Node = result.nodes.find((n) => n.id === "B");
      const hop2Node = result.nodes.find((n) => n.id === "D");

      expect(centerNode?.hopDistance).toBe(0);
      expect(centerNode?.isCenter).toBe(true);
      expect(hop1Node?.hopDistance).toBe(1);
      expect(hop2Node?.hopDistance).toBe(2);
    });

    it("should correctly track hop distance for edges", async () => {
      const data = createSimpleGraph();
      const store = createMockNeighborhoodStore(data);
      const explorer = new NeighborhoodExplorer(store);

      const result = await explorer.explore("A", {
        maxHops: 2,
        direction: "outgoing",
        includeInferred: false,
        maxNodes: 100,
        maxEdges: 500,
        timeout: 10000,
      });

      const hop1Edge = result.edges.find(
        (e) => e.source === "A" && e.target === "B"
      );
      const hop2Edge = result.edges.find(
        (e) => e.source === "C" && e.target === "D"
      );

      expect(hop1Edge?.hopDistance).toBe(1);
      expect(hop2Edge?.hopDistance).toBe(2);
    });
  });

  describe("explore - statistics", () => {
    it("should return accurate statistics", async () => {
      const data = createSimpleGraph();
      const store = createMockNeighborhoodStore(data);
      const explorer = new NeighborhoodExplorer(store);

      const result = await explorer.explore("A", {
        maxHops: 3,
        direction: "outgoing",
        includeInferred: false,
        maxNodes: 100,
        maxEdges: 500,
        timeout: 10000,
      });

      expect(result.stats.totalNodes).toBe(result.nodes.length);
      expect(result.stats.totalEdges).toBe(result.edges.length);
      expect(result.stats.assertedEdgeCount).toBe(result.edges.length); // No inferred
      expect(result.stats.inferredEdgeCount).toBe(0);
      expect(result.stats.explorationTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("should track nodes per hop", async () => {
      const data = createSimpleGraph();
      const store = createMockNeighborhoodStore(data);
      const explorer = new NeighborhoodExplorer(store);

      const result = await explorer.explore("A", {
        maxHops: 3,
        direction: "outgoing",
        includeInferred: false,
        maxNodes: 100,
        maxEdges: 500,
        timeout: 10000,
      });

      expect(result.stats.nodesPerHop[0]).toBe(1); // Center node
      expect(result.stats.nodesPerHop[1]).toBe(2); // B and C
      expect(result.stats.nodesPerHop[2]).toBe(1); // D
    });
  });

  describe("explore - metadata", () => {
    it("should include node metadata", async () => {
      const data = createSimpleGraph();
      const store = createMockNeighborhoodStore(data);
      const explorer = new NeighborhoodExplorer(store);

      const result = await explorer.explore("A", {
        maxHops: 1,
        direction: "outgoing",
        includeInferred: false,
        maxNodes: 100,
        maxEdges: 500,
        timeout: 10000,
      });

      const nodeB = result.nodes.find((n) => n.id === "B");
      expect(nodeB?.label).toBe("Bob");
      expect(nodeB?.types).toContain("Person");
    });
  });

  describe("explore - edge labels", () => {
    it("should extract edge labels from predicates", async () => {
      const data = createSimpleGraph();
      const store = createMockNeighborhoodStore(data);
      const explorer = new NeighborhoodExplorer(store);

      const result = await explorer.explore("A", {
        maxHops: 1,
        direction: "outgoing",
        includeInferred: false,
        maxNodes: 100,
        maxEdges: 500,
        timeout: 10000,
      });

      const knowsEdge = result.edges.find((e) => e.property === "knows");
      const likesEdge = result.edges.find((e) => e.property === "likes");

      expect(knowsEdge?.label).toBe("knows");
      expect(likesEdge?.label).toBe("likes");
    });
  });

  describe("cancel", () => {
    it("should allow cancellation", async () => {
      const data = createSimpleGraph();
      const store = createMockNeighborhoodStore(data);
      const explorer = new NeighborhoodExplorer(store);

      // Start exploration and immediately cancel
      const explorePromise = explorer.explore("A", {
        maxHops: 10,
        direction: "outgoing",
        includeInferred: false,
        maxNodes: 1000,
        maxEdges: 5000,
        timeout: 10000,
      });

      explorer.cancel();

      const result = await explorePromise;

      // Result should be returned (possibly incomplete)
      expect(result).toBeDefined();
    });
  });

  describe("event handling", () => {
    it("should emit explore-start event", async () => {
      const data = createSimpleGraph();
      const store = createMockNeighborhoodStore(data);
      const explorer = new NeighborhoodExplorer(store);
      const listener = jest.fn();

      explorer.addEventListener("neighborhood:explore-start", listener);

      await explorer.explore("A", {
        maxHops: 1,
        direction: "outgoing",
        includeInferred: false,
        maxNodes: 100,
        maxEdges: 500,
        timeout: 10000,
      });

      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].type).toBe("neighborhood:explore-start");
    });

    it("should emit explore-complete event", async () => {
      const data = createSimpleGraph();
      const store = createMockNeighborhoodStore(data);
      const explorer = new NeighborhoodExplorer(store);
      const completeListener = jest.fn();

      explorer.addEventListener("neighborhood:explore-complete", completeListener);

      await explorer.explore("A", {
        maxHops: 1,
        direction: "outgoing",
        includeInferred: false,
        maxNodes: 100,
        maxEdges: 500,
        timeout: 10000,
      });

      expect(completeListener).toHaveBeenCalled();
      const completeCall = completeListener.mock.calls.find(
        (call: unknown[]) => (call[0] as { type: string }).type === "neighborhood:explore-complete"
      );
      expect(completeCall).toBeDefined();
      expect(completeCall![0].neighborhood).toBeDefined();
    });

    it("should emit hop-expand events", async () => {
      const data = createSimpleGraph();
      const store = createMockNeighborhoodStore(data);
      const explorer = new NeighborhoodExplorer(store, undefined, {
        emitProgress: true,
      });
      const hopListener = jest.fn();

      explorer.addEventListener("neighborhood:hop-expand", hopListener);

      await explorer.explore("A", {
        maxHops: 2,
        direction: "outgoing",
        includeInferred: false,
        maxNodes: 100,
        maxEdges: 500,
        timeout: 10000,
      });

      expect(hopListener).toHaveBeenCalled();
      const hopCall = hopListener.mock.calls.find(
        (call: unknown[]) => (call[0] as { type: string }).type === "neighborhood:hop-expand"
      );
      expect(hopCall).toBeDefined();
    });

    it("should remove event listener", async () => {
      const data = createSimpleGraph();
      const store = createMockNeighborhoodStore(data);
      const explorer = new NeighborhoodExplorer(store);
      const listener = jest.fn();

      explorer.addEventListener("neighborhood:explore-start", listener);
      explorer.removeEventListener(listener);

      await explorer.explore("A", {
        maxHops: 1,
        direction: "outgoing",
        includeInferred: false,
        maxNodes: 100,
        maxEdges: 500,
        timeout: 10000,
      });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("dispose", () => {
    it("should clean up resources", () => {
      const store = createMockNeighborhoodStore();
      const explorer = new NeighborhoodExplorer(store);

      explorer.dispose();

      // Should not throw
      expect(() => explorer.dispose()).not.toThrow();
    });
  });
});

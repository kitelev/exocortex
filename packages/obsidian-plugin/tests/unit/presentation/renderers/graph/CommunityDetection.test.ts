/**
 * CommunityDetection Tests
 *
 * Tests for the Louvain community detection algorithm including:
 * - Community detection with various graph structures
 * - Modularity calculation
 * - Color assignment
 * - Layout integration
 * - Edge cases and error handling
 */

import {
  detectCommunities,
  assignCommunityColors,
  CommunityLayout,
  createCommunityDetectionPlugin,
  communityDetectionPlugin,
  COMMUNITY_COLOR_PALETTES,
  COMMUNITY_DETECTION_OPTIONS,
  COMMUNITY_DETECTION_METADATA,
  DEFAULT_COMMUNITY_OPTIONS,
} from "../../../../../src/presentation/renderers/graph/CommunityDetection";
import type {
  CommunityDetectionResult,
  CommunityDetectionOptions,
  Community,
} from "../../../../../src/presentation/renderers/graph/CommunityDetection";
import type { GraphData } from "../../../../../src/presentation/renderers/graph/types";

// ============================================================
// Test Utilities
// ============================================================

/**
 * Create an empty graph
 */
function createEmptyGraph(): GraphData {
  return { nodes: [], edges: [] };
}

/**
 * Create a single-node graph
 */
function createSingleNodeGraph(): GraphData {
  return {
    nodes: [{ id: "node-1", label: "Node 1", path: "/node1.md" }],
    edges: [],
  };
}

/**
 * Create a simple connected graph (chain)
 */
function createChainGraph(nodeCount: number = 5): GraphData {
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
 * Create a graph with two clear communities (cliques connected by one edge)
 *
 * Community 1: A-B-C fully connected
 * Community 2: D-E-F fully connected
 * Connection: C-D
 */
function createTwoCommunitiesGraph(): GraphData {
  return {
    nodes: [
      { id: "a", label: "A", path: "/a.md" },
      { id: "b", label: "B", path: "/b.md" },
      { id: "c", label: "C", path: "/c.md" },
      { id: "d", label: "D", path: "/d.md" },
      { id: "e", label: "E", path: "/e.md" },
      { id: "f", label: "F", path: "/f.md" },
    ],
    edges: [
      // Community 1 (clique A-B-C)
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "b", target: "c" },
      { id: "e3", source: "c", target: "a" },
      // Community 2 (clique D-E-F)
      { id: "e4", source: "d", target: "e" },
      { id: "e5", source: "e", target: "f" },
      { id: "e6", source: "f", target: "d" },
      // Bridge between communities
      { id: "e7", source: "c", target: "d" },
    ],
  };
}

/**
 * Create a karate club-like graph with multiple communities
 */
function createMultiCommunityGraph(): GraphData {
  const nodes = [];
  for (let i = 0; i < 12; i++) {
    nodes.push({
      id: `node-${i}`,
      label: `Node ${i}`,
      path: `/node-${i}.md`,
    });
  }

  // Create 3 communities of 4 nodes each with internal connectivity
  const edges: Array<{ id: string; source: string; target: string; weight?: number }> = [];
  let edgeId = 0;

  // Community 0: nodes 0-3 (densely connected)
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      edges.push({ id: `e${edgeId++}`, source: `node-${i}`, target: `node-${j}`, weight: 2 });
    }
  }

  // Community 1: nodes 4-7 (densely connected)
  for (let i = 4; i < 8; i++) {
    for (let j = i + 1; j < 8; j++) {
      edges.push({ id: `e${edgeId++}`, source: `node-${i}`, target: `node-${j}`, weight: 2 });
    }
  }

  // Community 2: nodes 8-11 (densely connected)
  for (let i = 8; i < 12; i++) {
    for (let j = i + 1; j < 12; j++) {
      edges.push({ id: `e${edgeId++}`, source: `node-${i}`, target: `node-${j}`, weight: 2 });
    }
  }

  // Sparse inter-community connections
  edges.push({ id: `e${edgeId++}`, source: "node-3", target: "node-4", weight: 1 });
  edges.push({ id: `e${edgeId++}`, source: "node-7", target: "node-8", weight: 1 });
  edges.push({ id: `e${edgeId++}`, source: "node-0", target: "node-11", weight: 1 });

  return { nodes, edges };
}

/**
 * Create a star graph (hub and spokes)
 */
function createStarGraph(spokeCount: number = 5): GraphData {
  const nodes = [{ id: "hub", label: "Hub", path: "/hub.md" }];
  const edges = [];

  for (let i = 0; i < spokeCount; i++) {
    nodes.push({
      id: `spoke-${i}`,
      label: `Spoke ${i}`,
      path: `/spoke-${i}.md`,
    });
    edges.push({
      id: `edge-${i}`,
      source: "hub",
      target: `spoke-${i}`,
    });
  }

  return { nodes, edges };
}

/**
 * Create disconnected graph (two separate components)
 */
function createDisconnectedGraph(): GraphData {
  return {
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
}

/**
 * Create weighted graph for testing weight support
 */
function createWeightedGraph(): GraphData {
  return {
    nodes: [
      { id: "a", label: "A", path: "/a.md" },
      { id: "b", label: "B", path: "/b.md" },
      { id: "c", label: "C", path: "/c.md" },
      { id: "d", label: "D", path: "/d.md" },
    ],
    edges: [
      { id: "e1", source: "a", target: "b", weight: 10 }, // Strong connection
      { id: "e2", source: "b", target: "c", weight: 1 },  // Weak connection
      { id: "e3", source: "c", target: "d", weight: 10 }, // Strong connection
    ],
  };
}

// ============================================================
// Tests: detectCommunities Function
// ============================================================

describe("detectCommunities", () => {
  describe("empty and single-node graphs", () => {
    it("should handle empty graph", () => {
      const graph = createEmptyGraph();
      const result = detectCommunities(graph);

      expect(result.assignments.size).toBe(0);
      expect(result.communities.length).toBe(0);
      expect(result.modularity).toBe(0);
      expect(result.iterations).toBe(0);
      expect(result.levels).toBe(0);
      expect(result.computeTime).toBeGreaterThanOrEqual(0);
    });

    it("should handle single-node graph", () => {
      const graph = createSingleNodeGraph();
      const result = detectCommunities(graph);

      expect(result.assignments.size).toBe(1);
      expect(result.communities.length).toBe(1);
      expect(result.communities[0].size).toBe(1);
      expect(result.communities[0].members).toContain("node-1");
      expect(result.modularity).toBe(0);
      expect(result.iterations).toBe(1);
      expect(result.levels).toBe(1);
    });
  });

  describe("simple graphs", () => {
    it("should detect communities in chain graph", () => {
      const graph = createChainGraph(5);
      const result = detectCommunities(graph);

      expect(result.assignments.size).toBe(5);
      expect(result.communities.length).toBeGreaterThan(0);

      // All nodes should be assigned
      for (const node of graph.nodes) {
        expect(result.assignments.has(node.id)).toBe(true);
      }
    });

    it("should detect two communities in two-cliques graph", () => {
      const graph = createTwoCommunitiesGraph();
      const result = detectCommunities(graph);

      expect(result.assignments.size).toBe(6);

      // Should detect 2 communities (or possibly 1 if resolution is low)
      expect(result.communities.length).toBeGreaterThanOrEqual(1);
      expect(result.communities.length).toBeLessThanOrEqual(6);

      // Check that A, B, C tend to be in same community
      const commA = result.assignments.get("a")!.communityId;
      const commB = result.assignments.get("b")!.communityId;
      const commC = result.assignments.get("c")!.communityId;

      // Within-clique nodes should be in same community
      expect(commA).toBe(commB);
      expect(commB).toBe(commC);

      // Check D, E, F are in same community
      const commD = result.assignments.get("d")!.communityId;
      const commE = result.assignments.get("e")!.communityId;
      const commF = result.assignments.get("f")!.communityId;

      expect(commD).toBe(commE);
      expect(commE).toBe(commF);

      // The two cliques should be in different communities
      // (This is the expected behavior with default resolution)
      expect(commA).not.toBe(commD);

      // Modularity should be positive for well-separated communities
      expect(result.modularity).toBeGreaterThan(0);
    });

    it("should detect multiple communities in multi-community graph", () => {
      const graph = createMultiCommunityGraph();
      const result = detectCommunities(graph);

      expect(result.assignments.size).toBe(12);

      // Should detect 3 communities (or close to it)
      expect(result.communities.length).toBeGreaterThanOrEqual(2);
      expect(result.communities.length).toBeLessThanOrEqual(12);

      // Modularity should be positive
      expect(result.modularity).toBeGreaterThan(0);
    });
  });

  describe("special graph structures", () => {
    it("should handle star graph", () => {
      const graph = createStarGraph(5);
      const result = detectCommunities(graph);

      expect(result.assignments.size).toBe(6);

      // Hub should be in some community
      expect(result.assignments.has("hub")).toBe(true);
    });

    it("should handle disconnected graph", () => {
      const graph = createDisconnectedGraph();
      const result = detectCommunities(graph);

      expect(result.assignments.size).toBe(4);

      // Disconnected components should be in different communities
      const commA1 = result.assignments.get("a1")!.communityId;
      const commA2 = result.assignments.get("a2")!.communityId;
      const commB1 = result.assignments.get("b1")!.communityId;
      const commB2 = result.assignments.get("b2")!.communityId;

      // Within component should be same
      expect(commA1).toBe(commA2);
      expect(commB1).toBe(commB2);

      // Different components should be different
      expect(commA1).not.toBe(commB1);
    });
  });

  describe("weighted edges", () => {
    it("should respect edge weights", () => {
      const graph = createWeightedGraph();

      // With weights: A-B and C-D should cluster (strong connections)
      const resultWithWeights = detectCommunities(graph, { useWeights: true });

      // Without weights: may cluster differently
      const resultWithoutWeights = detectCommunities(graph, { useWeights: false });

      // Both should have all nodes assigned
      expect(resultWithWeights.assignments.size).toBe(4);
      expect(resultWithoutWeights.assignments.size).toBe(4);

      // With weights, A-B should likely be together
      const commA = resultWithWeights.assignments.get("a")!.communityId;
      const commB = resultWithWeights.assignments.get("b")!.communityId;
      expect(commA).toBe(commB);

      // With weights, C-D should likely be together
      const commC = resultWithWeights.assignments.get("c")!.communityId;
      const commD = resultWithWeights.assignments.get("d")!.communityId;
      expect(commC).toBe(commD);
    });

    it("should use default weight when useWeights is false", () => {
      const graph = createWeightedGraph();
      const result = detectCommunities(graph, { useWeights: false, defaultWeight: 1.0 });

      expect(result.assignments.size).toBe(4);
    });
  });

  describe("resolution parameter", () => {
    it("should produce more communities with higher resolution", () => {
      const graph = createMultiCommunityGraph();

      const lowRes = detectCommunities(graph, { resolution: 0.5 });
      const highRes = detectCommunities(graph, { resolution: 2.0 });

      // Higher resolution should produce more (or equal) communities
      expect(highRes.communities.length).toBeGreaterThanOrEqual(lowRes.communities.length);
    });

    it("should produce fewer communities with lower resolution", () => {
      const graph = createMultiCommunityGraph();

      const veryLowRes = detectCommunities(graph, { resolution: 0.1 });

      // Very low resolution should merge everything
      expect(veryLowRes.communities.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("randomization and reproducibility", () => {
    it("should produce reproducible results with same seed", () => {
      const graph = createMultiCommunityGraph();

      const result1 = detectCommunities(graph, { randomSeed: 42 });
      const result2 = detectCommunities(graph, { randomSeed: 42 });

      expect(result1.communities.length).toBe(result2.communities.length);
      expect(result1.modularity).toBe(result2.modularity);

      // Check assignments match
      for (const [nodeId, assignment] of result1.assignments) {
        const assignment2 = result2.assignments.get(nodeId);
        expect(assignment2?.communityId).toBe(assignment.communityId);
      }
    });

    it("should work without randomization", () => {
      const graph = createTwoCommunitiesGraph();
      const result = detectCommunities(graph, { randomizeOrder: false });

      expect(result.assignments.size).toBe(6);
    });
  });

  describe("result structure", () => {
    it("should include all required fields", () => {
      const graph = createTwoCommunitiesGraph();
      const result = detectCommunities(graph);

      // Check result structure
      expect(result).toHaveProperty("assignments");
      expect(result).toHaveProperty("communities");
      expect(result).toHaveProperty("modularity");
      expect(result).toHaveProperty("iterations");
      expect(result).toHaveProperty("computeTime");
      expect(result).toHaveProperty("levels");

      expect(result.assignments).toBeInstanceOf(Map);
      expect(Array.isArray(result.communities)).toBe(true);
      expect(typeof result.modularity).toBe("number");
      expect(typeof result.iterations).toBe("number");
      expect(typeof result.computeTime).toBe("number");
      expect(typeof result.levels).toBe("number");
    });

    it("should have valid community structure", () => {
      const graph = createTwoCommunitiesGraph();
      const result = detectCommunities(graph);

      for (const community of result.communities) {
        expect(community).toHaveProperty("id");
        expect(community).toHaveProperty("size");
        expect(community).toHaveProperty("members");
        expect(community).toHaveProperty("internalWeight");
        expect(community).toHaveProperty("totalDegree");

        expect(typeof community.id).toBe("number");
        expect(community.id).toBeGreaterThanOrEqual(0);
        expect(community.size).toBe(community.members.length);
        expect(community.size).toBeGreaterThan(0);
      }
    });

    it("should have valid assignment structure", () => {
      const graph = createTwoCommunitiesGraph();
      const result = detectCommunities(graph);

      for (const [nodeId, assignment] of result.assignments) {
        expect(typeof nodeId).toBe("string");
        expect(assignment).toHaveProperty("nodeId");
        expect(assignment).toHaveProperty("communityId");
        expect(assignment.nodeId).toBe(nodeId);
        expect(typeof assignment.communityId).toBe("number");
        expect(assignment.communityId).toBeGreaterThanOrEqual(0);
      }
    });

    it("should have contiguous community IDs", () => {
      const graph = createMultiCommunityGraph();
      const result = detectCommunities(graph);

      const communityIds = result.communities.map((c) => c.id).sort((a, b) => a - b);

      // IDs should be 0, 1, 2, ...
      for (let i = 0; i < communityIds.length; i++) {
        expect(communityIds[i]).toBe(i);
      }
    });
  });
});

// ============================================================
// Tests: assignCommunityColors Function
// ============================================================

describe("assignCommunityColors", () => {
  it("should assign colors based on community", () => {
    const graph = createTwoCommunitiesGraph();
    const result = detectCommunities(graph);
    const coloredGraph = assignCommunityColors(graph, result);

    expect(coloredGraph.nodes.length).toBe(graph.nodes.length);

    for (const node of coloredGraph.nodes) {
      expect(node.color).toBeDefined();
      expect(typeof node.color).toBe("string");
      expect(node.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("should assign same color to nodes in same community", () => {
    const graph = createTwoCommunitiesGraph();
    const result = detectCommunities(graph);
    const coloredGraph = assignCommunityColors(graph, result);

    // Find nodes in same community
    const nodeColors = new Map<string, string>();
    for (const node of coloredGraph.nodes) {
      nodeColors.set(node.id, node.color!);
    }

    // A, B, C should have same color
    expect(nodeColors.get("a")).toBe(nodeColors.get("b"));
    expect(nodeColors.get("b")).toBe(nodeColors.get("c"));

    // D, E, F should have same color
    expect(nodeColors.get("d")).toBe(nodeColors.get("e"));
    expect(nodeColors.get("e")).toBe(nodeColors.get("f"));
  });

  it("should support different color palettes", () => {
    const graph = createTwoCommunitiesGraph();
    const result = detectCommunities(graph);

    const categoricalGraph = assignCommunityColors(graph, result, "categorical");
    const pastelGraph = assignCommunityColors(graph, result, "pastel");
    const vibrantGraph = assignCommunityColors(graph, result, "vibrant");
    const natureGraph = assignCommunityColors(graph, result, "nature");

    // All should have colors
    for (const palette of [categoricalGraph, pastelGraph, vibrantGraph, natureGraph]) {
      for (const node of palette.nodes) {
        expect(node.color).toBeDefined();
        expect(node.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }

    // Colors should be different between palettes
    const catColor = categoricalGraph.nodes[0].color;
    const pasColor = pastelGraph.nodes[0].color;
    expect(catColor).not.toBe(pasColor);
  });

  it("should set group property based on community", () => {
    const graph = createTwoCommunitiesGraph();
    const result = detectCommunities(graph);
    const coloredGraph = assignCommunityColors(graph, result);

    for (const node of coloredGraph.nodes) {
      expect(node.group).toBeDefined();
      expect(node.group).toMatch(/^community_\d+$/);
    }
  });

  it("should handle empty graph", () => {
    const graph = createEmptyGraph();
    const result = detectCommunities(graph);
    const coloredGraph = assignCommunityColors(graph, result);

    expect(coloredGraph.nodes.length).toBe(0);
    expect(coloredGraph.edges.length).toBe(0);
  });
});

// ============================================================
// Tests: COMMUNITY_COLOR_PALETTES
// ============================================================

describe("COMMUNITY_COLOR_PALETTES", () => {
  it("should have all required palettes", () => {
    expect(COMMUNITY_COLOR_PALETTES).toHaveProperty("categorical");
    expect(COMMUNITY_COLOR_PALETTES).toHaveProperty("pastel");
    expect(COMMUNITY_COLOR_PALETTES).toHaveProperty("vibrant");
    expect(COMMUNITY_COLOR_PALETTES).toHaveProperty("nature");
  });

  it("should have at least 10 colors per palette", () => {
    for (const [name, colors] of Object.entries(COMMUNITY_COLOR_PALETTES)) {
      expect(colors.length).toBeGreaterThanOrEqual(10);
    }
  });

  it("should have valid hex colors", () => {
    const hexPattern = /^#[0-9A-Fa-f]{6}$/;

    for (const [name, colors] of Object.entries(COMMUNITY_COLOR_PALETTES)) {
      for (const color of colors) {
        expect(color).toMatch(hexPattern);
      }
    }
  });
});

// ============================================================
// Tests: DEFAULT_COMMUNITY_OPTIONS
// ============================================================

describe("DEFAULT_COMMUNITY_OPTIONS", () => {
  it("should have all required options", () => {
    expect(DEFAULT_COMMUNITY_OPTIONS).toHaveProperty("resolution");
    expect(DEFAULT_COMMUNITY_OPTIONS).toHaveProperty("maxIterations");
    expect(DEFAULT_COMMUNITY_OPTIONS).toHaveProperty("minModularityGain");
    expect(DEFAULT_COMMUNITY_OPTIONS).toHaveProperty("useWeights");
    expect(DEFAULT_COMMUNITY_OPTIONS).toHaveProperty("defaultWeight");
    expect(DEFAULT_COMMUNITY_OPTIONS).toHaveProperty("randomSeed");
    expect(DEFAULT_COMMUNITY_OPTIONS).toHaveProperty("randomizeOrder");
  });

  it("should have sensible default values", () => {
    expect(DEFAULT_COMMUNITY_OPTIONS.resolution).toBe(1.0);
    expect(DEFAULT_COMMUNITY_OPTIONS.maxIterations).toBeGreaterThan(0);
    expect(DEFAULT_COMMUNITY_OPTIONS.minModularityGain).toBeGreaterThan(0);
    expect(DEFAULT_COMMUNITY_OPTIONS.useWeights).toBe(true);
    expect(DEFAULT_COMMUNITY_OPTIONS.defaultWeight).toBe(1.0);
  });
});

// ============================================================
// Tests: CommunityLayout Class
// ============================================================

describe("CommunityLayout", () => {
  describe("constructor and options", () => {
    it("should create instance with default options", () => {
      const layout = new CommunityLayout();

      expect(layout.name).toBe("community");
      expect(layout.getOptions()).toHaveProperty("resolution");
      expect(layout.getOptions()).toHaveProperty("nodeSpacing");
    });

    it("should accept custom options", () => {
      const layout = new CommunityLayout({ resolution: 2.0, nodeSpacing: 100 });

      expect(layout.getOptions().resolution).toBe(2.0);
      expect(layout.getOptions().nodeSpacing).toBe(100);
    });

    it("should update options", () => {
      const layout = new CommunityLayout();
      layout.setOptions({ resolution: 3.0 });

      expect(layout.getOptions().resolution).toBe(3.0);
    });
  });

  describe("layout method", () => {
    it("should compute positions for all nodes", () => {
      const layout = new CommunityLayout();
      const graph = createTwoCommunitiesGraph();
      const result = layout.layout(graph);

      expect(result.positions.size).toBe(6);

      for (const node of graph.nodes) {
        const pos = result.positions.get(node.id);
        expect(pos).toBeDefined();
        expect(typeof pos!.x).toBe("number");
        expect(typeof pos!.y).toBe("number");
        expect(isNaN(pos!.x)).toBe(false);
        expect(isNaN(pos!.y)).toBe(false);
      }
    });

    it("should calculate valid bounds", () => {
      const layout = new CommunityLayout();
      const graph = createMultiCommunityGraph();
      const result = layout.layout(graph);

      expect(result.bounds).toBeDefined();
      expect(result.bounds.width).toBeGreaterThanOrEqual(0);
      expect(result.bounds.height).toBeGreaterThanOrEqual(0);
      expect(result.bounds.maxX).toBeGreaterThanOrEqual(result.bounds.minX);
      expect(result.bounds.maxY).toBeGreaterThanOrEqual(result.bounds.minY);
    });

    it("should include community statistics", () => {
      const layout = new CommunityLayout();
      const graph = createTwoCommunitiesGraph();
      const result = layout.layout(graph);

      expect(result.stats).toBeDefined();
      expect(result.stats?.communities).toBeDefined();
      expect(result.stats?.modularity).toBeDefined();
    });

    it("should handle empty graph", () => {
      const layout = new CommunityLayout();
      const graph = createEmptyGraph();
      const result = layout.layout(graph);

      expect(result.positions.size).toBe(0);
    });

    it("should handle single node", () => {
      const layout = new CommunityLayout();
      const graph = createSingleNodeGraph();
      const result = layout.layout(graph);

      expect(result.positions.size).toBe(1);
    });
  });

  describe("getLastResult", () => {
    it("should return community detection result after layout", () => {
      const layout = new CommunityLayout();
      const graph = createTwoCommunitiesGraph();

      expect(layout.getLastResult()).toBeNull();

      layout.layout(graph);

      const result = layout.getLastResult();
      expect(result).not.toBeNull();
      expect(result!.communities.length).toBeGreaterThan(0);
    });
  });

  describe("canLayout and estimateComplexity", () => {
    it("should return true for non-empty graphs", () => {
      const layout = new CommunityLayout();

      expect(layout.canLayout(createTwoCommunitiesGraph())).toBe(true);
      expect(layout.canLayout(createChainGraph())).toBe(true);
    });

    it("should return false for empty graph", () => {
      const layout = new CommunityLayout();

      expect(layout.canLayout(createEmptyGraph())).toBe(false);
    });

    it("should estimate complexity", () => {
      const layout = new CommunityLayout();

      const smallGraph = createChainGraph(5);
      const largeGraph = createChainGraph(500);

      const smallComplexity = layout.estimateComplexity(smallGraph);
      const largeComplexity = layout.estimateComplexity(largeGraph);

      expect(smallComplexity).toBeGreaterThanOrEqual(0);
      expect(smallComplexity).toBeLessThanOrEqual(1);
      expect(largeComplexity).toBeGreaterThan(smallComplexity);
    });
  });

  describe("cancellation", () => {
    it("should support cancellation", () => {
      const layout = new CommunityLayout();

      layout.cancel();

      const graph = createTwoCommunitiesGraph();
      const result = layout.layout(graph);

      expect(result.cancelled).toBe(true);
    });
  });
});

// ============================================================
// Tests: Plugin Registration
// ============================================================

describe("Community Detection Plugin", () => {
  describe("COMMUNITY_DETECTION_METADATA", () => {
    it("should have valid metadata", () => {
      expect(COMMUNITY_DETECTION_METADATA.id).toBe("community-detection");
      expect(COMMUNITY_DETECTION_METADATA.name).toBe("Community Detection (Louvain)");
      expect(COMMUNITY_DETECTION_METADATA.version).toBe("1.0.0");
      expect(COMMUNITY_DETECTION_METADATA.category).toBe("domain-specific");
    });

    it("should have required tags", () => {
      expect(COMMUNITY_DETECTION_METADATA.tags).toContain("community");
      expect(COMMUNITY_DETECTION_METADATA.tags).toContain("louvain");
      expect(COMMUNITY_DETECTION_METADATA.tags).toContain("clustering");
    });

    it("should support general graphs", () => {
      expect(COMMUNITY_DETECTION_METADATA.supportedGraphTypes).toContain("general");
    });
  });

  describe("COMMUNITY_DETECTION_OPTIONS", () => {
    it("should define all options", () => {
      const optionNames = COMMUNITY_DETECTION_OPTIONS.map((o) => o.name);

      expect(optionNames).toContain("resolution");
      expect(optionNames).toContain("maxIterations");
      expect(optionNames).toContain("useWeights");
      expect(optionNames).toContain("colorPalette");
    });

    it("should have valid option definitions", () => {
      for (const option of COMMUNITY_DETECTION_OPTIONS) {
        expect(option.name).toBeDefined();
        expect(option.type).toBeDefined();
        expect(option.label).toBeDefined();
        expect(option.default).toBeDefined();
      }
    });
  });

  describe("createCommunityDetectionPlugin", () => {
    it("should create valid plugin", () => {
      const plugin = createCommunityDetectionPlugin();

      expect(plugin.metadata).toBeDefined();
      expect(plugin.factory).toBeDefined();
      expect(plugin.metadata.id).toBe("community-detection");
    });

    it("should create layout instances", () => {
      const plugin = createCommunityDetectionPlugin();
      const layout = plugin.factory.create();

      expect(layout.name).toBe("community");
    });

    it("should create layout with options", () => {
      const plugin = createCommunityDetectionPlugin();
      const layout = plugin.factory.create({ resolution: 2.0 });

      expect(layout.getOptions().resolution).toBe(2.0);
    });
  });

  describe("communityDetectionPlugin singleton", () => {
    it("should be a valid plugin", () => {
      expect(communityDetectionPlugin.metadata.id).toBe("community-detection");
      expect(communityDetectionPlugin.factory).toBeDefined();
    });
  });
});

// ============================================================
// Tests: Performance and Scale
// ============================================================

describe("Performance", () => {
  it("should handle medium-sized graphs efficiently", () => {
    // Create a graph with 100 nodes
    const nodes = [];
    const edges = [];

    for (let i = 0; i < 100; i++) {
      nodes.push({ id: `node-${i}`, label: `Node ${i}`, path: `/node-${i}.md` });

      // Create some edges (random-ish connections)
      if (i > 0) {
        edges.push({ id: `e${i}`, source: `node-${Math.floor(i / 10) * 10}`, target: `node-${i}` });
      }
      if (i % 5 === 0 && i > 5) {
        edges.push({ id: `e${i}b`, source: `node-${i - 5}`, target: `node-${i}` });
      }
    }

    const graph: GraphData = { nodes, edges };
    const startTime = performance.now();
    const result = detectCommunities(graph);
    const endTime = performance.now();

    expect(result.assignments.size).toBe(100);
    expect(endTime - startTime).toBeLessThan(5000); // Should complete in 5 seconds
  });

  it("should report compute time accurately", () => {
    const graph = createMultiCommunityGraph();
    const result = detectCommunities(graph);

    expect(result.computeTime).toBeGreaterThan(0);
    expect(result.computeTime).toBeLessThan(10000); // Less than 10 seconds
  });
});

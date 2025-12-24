/**
 * ClusterRenderer tests
 *
 * Tests for cluster visualization rendering, selection, and events.
 */

import {
  ClusterRenderer,
  type ClusterRendererConfig,
} from "@plugin/presentation/renderers/graph/cluster/ClusterRenderer";
import type {
  ClusterVisualizationData,
  ClusterVisualizationOptions,
  ClusterNode,
  ClusterEdge,
} from "@plugin/presentation/renderers/graph/cluster/ClusterTypes";
import { DEFAULT_CLUSTER_VISUALIZATION_OPTIONS } from "@plugin/presentation/renderers/graph/cluster/ClusterTypes";
import type { Community, CommunityDetectionResult, CommunityAssignment } from "@plugin/presentation/renderers/graph";

// Mock canvas context
function createMockContext(): CanvasRenderingContext2D {
  return {
    clearRect: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    beginPath: jest.fn(),
    closePath: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    arc: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    quadraticCurveTo: jest.fn(),
    setLineDash: jest.fn(),
    fillRect: jest.fn(),
    fillText: jest.fn(),
    measureText: jest.fn().mockReturnValue({ width: 50 }),
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    textBaseline: "top",
  } as unknown as CanvasRenderingContext2D;
}

// Mock createElement to return mock canvas
const originalCreateElement = document.createElement.bind(document);

describe("ClusterRenderer", () => {
  let renderer: ClusterRenderer;
  let mockContext: CanvasRenderingContext2D;
  let container: HTMLDivElement;

  beforeEach(() => {
    mockContext = createMockContext();

    // Create mock container
    container = document.createElement("div");
    container.style.width = "800px";
    container.style.height = "600px";
    document.body.appendChild(container);

    // Mock canvas creation
    jest.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      if (tagName === "canvas") {
        const canvas = originalCreateElement("canvas") as HTMLCanvasElement;
        jest.spyOn(canvas, "getContext").mockReturnValue(mockContext);
        Object.defineProperty(canvas, "width", { value: 800, writable: true });
        Object.defineProperty(canvas, "height", { value: 600, writable: true });
        return canvas;
      }
      return originalCreateElement(tagName);
    });

    renderer = new ClusterRenderer({ container, width: 800, height: 600 });
  });

  afterEach(() => {
    renderer.dispose();
    document.body.removeChild(container);
    jest.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create renderer with default options", () => {
      const r = new ClusterRenderer();
      expect(r.getOptions()).toEqual(DEFAULT_CLUSTER_VISUALIZATION_OPTIONS);
      r.dispose();
    });

    it("should create renderer with custom options", () => {
      const options: Partial<ClusterVisualizationOptions> = {
        colorPalette: "vibrant",
        showClusterBoundaries: false,
      };
      const r = new ClusterRenderer({ options });
      expect(r.getOptions().colorPalette).toBe("vibrant");
      expect(r.getOptions().showClusterBoundaries).toBe(false);
      r.dispose();
    });

    it("should attach to container when provided", () => {
      expect(container.children.length).toBe(1);
      expect(container.children[0].tagName).toBe("CANVAS");
    });
  });

  describe("attach", () => {
    it("should attach to a new container", () => {
      const newContainer = document.createElement("div");
      document.body.appendChild(newContainer);

      const r = new ClusterRenderer();
      r.attach(newContainer);

      expect(newContainer.children.length).toBe(1);

      r.dispose();
      document.body.removeChild(newContainer);
    });
  });

  describe("setData", () => {
    it("should set visualization data", () => {
      const data = createMockVisualizationData();
      renderer.setData(data);

      const boundaries = renderer.getBoundaries();
      expect(boundaries.length).toBeGreaterThan(0);
    });

    it("should calculate cluster boundaries", () => {
      const data = createMockVisualizationData();
      renderer.setData(data);

      const boundaries = renderer.getBoundaries();
      expect(boundaries[0].clusterId).toBe(0);
      expect(boundaries[0].color).toBeDefined();
      expect(boundaries[0].bounds).toBeDefined();
      expect(boundaries[0].center).toBeDefined();
    });
  });

  describe("setOptions", () => {
    it("should update visualization options", () => {
      renderer.setOptions({ showClusterBoundaries: false });
      expect(renderer.getOptions().showClusterBoundaries).toBe(false);
    });

    it("should re-render after options change", () => {
      const data = createMockVisualizationData();
      renderer.setData(data);

      const clearRectSpy = mockContext.clearRect;
      renderer.setOptions({ colorPalette: "pastel" });

      expect(clearRectSpy).toHaveBeenCalled();
    });
  });

  describe("selection", () => {
    beforeEach(() => {
      renderer.setData(createMockVisualizationData());
    });

    it("should select a cluster", () => {
      renderer.selectCluster(0);

      const state = renderer.getSelectionState();
      expect(state.selectedClusters.has(0)).toBe(true);
    });

    it("should support additive selection", () => {
      renderer.selectCluster(0);
      renderer.selectCluster(1, true);

      const state = renderer.getSelectionState();
      expect(state.selectedClusters.has(0)).toBe(true);
      expect(state.selectedClusters.has(1)).toBe(true);
    });

    it("should replace selection without additive flag", () => {
      renderer.selectCluster(0);
      renderer.selectCluster(1);

      const state = renderer.getSelectionState();
      expect(state.selectedClusters.has(0)).toBe(false);
      expect(state.selectedClusters.has(1)).toBe(true);
    });

    it("should deselect a cluster", () => {
      renderer.selectCluster(0);
      renderer.deselectCluster(0);

      const state = renderer.getSelectionState();
      expect(state.selectedClusters.has(0)).toBe(false);
    });

    it("should clear all selections", () => {
      renderer.selectCluster(0);
      renderer.selectCluster(1, true);
      renderer.clearSelection();

      const state = renderer.getSelectionState();
      expect(state.selectedClusters.size).toBe(0);
    });
  });

  describe("expand/collapse", () => {
    beforeEach(() => {
      renderer.setData(createMockVisualizationData());
    });

    it("should expand a cluster", () => {
      renderer.expandCluster(0);

      const state = renderer.getSelectionState();
      expect(state.expandedClusters.has(0)).toBe(true);
      expect(state.collapsedClusters.has(0)).toBe(false);
    });

    it("should collapse a cluster", () => {
      renderer.expandCluster(0);
      renderer.collapseCluster(0);

      const state = renderer.getSelectionState();
      expect(state.expandedClusters.has(0)).toBe(false);
      expect(state.collapsedClusters.has(0)).toBe(true);
    });
  });

  describe("events", () => {
    beforeEach(() => {
      renderer.setData(createMockVisualizationData());
    });

    it("should emit cluster-select event", () => {
      const listener = jest.fn();
      renderer.on("cluster-select", listener);

      renderer.selectCluster(0);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "cluster-select",
          clusterId: 0,
        })
      );
    });

    it("should emit cluster-expand event", () => {
      const listener = jest.fn();
      renderer.on("cluster-expand", listener);

      renderer.expandCluster(0);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "cluster-expand",
          clusterId: 0,
        })
      );
    });

    it("should emit cluster-collapse event", () => {
      const listener = jest.fn();
      renderer.on("cluster-collapse", listener);

      renderer.collapseCluster(0);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "cluster-collapse",
          clusterId: 0,
        })
      );
    });

    it("should remove event listener", () => {
      const listener = jest.fn();
      renderer.on("cluster-select", listener);
      renderer.off("cluster-select", listener);

      renderer.selectCluster(0);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("render", () => {
    it("should clear canvas before rendering", () => {
      renderer.setData(createMockVisualizationData());
      renderer.render();

      expect(mockContext.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
    });

    it("should render cluster boundaries when enabled", () => {
      renderer.setData(createMockVisualizationData());
      renderer.render();

      expect(mockContext.beginPath).toHaveBeenCalled();
      expect(mockContext.fill).toHaveBeenCalled();
    });

    it("should not render boundaries when disabled", () => {
      renderer.setOptions({ showClusterBoundaries: false });
      renderer.setData(createMockVisualizationData());

      // Clear previous calls
      jest.clearAllMocks();
      renderer.render();

      // Should still render nodes but with fewer fill calls for boundaries
      expect(mockContext.arc).toHaveBeenCalled(); // For nodes
    });

    it("should render nodes", () => {
      renderer.setData(createMockVisualizationData());
      renderer.render();

      expect(mockContext.arc).toHaveBeenCalled();
    });

    it("should render edges", () => {
      renderer.setData(createMockVisualizationData());
      renderer.render();

      expect(mockContext.moveTo).toHaveBeenCalled();
      expect(mockContext.lineTo).toHaveBeenCalled();
    });

    it("should render cluster labels when enabled", () => {
      renderer.setData(createMockVisualizationData());
      renderer.render();

      expect(mockContext.fillText).toHaveBeenCalled();
    });
  });

  describe("buildVisualizationData", () => {
    it("should build visualization data from graph and detection result", () => {
      const graph = {
        nodes: [
          { id: "node1", label: "Node 1", path: "/path/1" },
          { id: "node2", label: "Node 2", path: "/path/2" },
          { id: "node3", label: "Node 3", path: "/path/3" },
        ],
        edges: [
          { id: "edge1", source: "node1", target: "node2" },
          { id: "edge2", source: "node2", target: "node3" },
        ],
      };

      const result: CommunityDetectionResult = {
        assignments: new Map<string, CommunityAssignment>([
          ["node1", { nodeId: "node1", communityId: 0 }],
          ["node2", { nodeId: "node2", communityId: 0 }],
          ["node3", { nodeId: "node3", communityId: 1 }],
        ]),
        communities: [
          { id: 0, size: 2, members: ["node1", "node2"], internalWeight: 1, totalDegree: 3 },
          { id: 1, size: 1, members: ["node3"], internalWeight: 0, totalDegree: 1 },
        ],
        modularity: 0.5,
        iterations: 3,
        computeTime: 10,
        levels: 1,
      };

      const data = ClusterRenderer.buildVisualizationData(graph, result);

      expect(data.nodes).toHaveLength(3);
      expect(data.nodes[0].clusterId).toBe(0);
      expect(data.nodes[0].clusterColor).toBeDefined();

      expect(data.edges).toHaveLength(2);
      expect(data.edges[0].isIntraCluster).toBe(true);
      expect(data.edges[1].isIntraCluster).toBe(false);

      expect(data.modularity).toBe(0.5);
    });
  });

  describe("dispose", () => {
    it("should remove canvas from container", () => {
      renderer.dispose();
      expect(container.children.length).toBe(0);
    });

    it("should clear listeners", () => {
      const listener = jest.fn();
      renderer.on("cluster-select", listener);
      renderer.dispose();

      // Should not throw
      expect(() => renderer.selectCluster(0)).not.toThrow();
    });
  });
});

// Helper function to create mock visualization data
function createMockVisualizationData(): ClusterVisualizationData {
  const nodes: ClusterNode[] = [
    { id: "node1", label: "Node 1", path: "/path/1", x: -50, y: -50, clusterId: 0, clusterColor: "#1f77b4" },
    { id: "node2", label: "Node 2", path: "/path/2", x: 50, y: -50, clusterId: 0, clusterColor: "#1f77b4" },
    { id: "node3", label: "Node 3", path: "/path/3", x: 0, y: 50, clusterId: 0, clusterColor: "#1f77b4" },
    { id: "node4", label: "Node 4", path: "/path/4", x: 150, y: 0, clusterId: 1, clusterColor: "#ff7f0e" },
    { id: "node5", label: "Node 5", path: "/path/5", x: 200, y: 50, clusterId: 1, clusterColor: "#ff7f0e" },
  ];

  const edges: ClusterEdge[] = [
    { id: "edge1", source: "node1", target: "node2", isIntraCluster: true, sourceClusterId: 0, targetClusterId: 0 },
    { id: "edge2", source: "node2", target: "node3", isIntraCluster: true, sourceClusterId: 0, targetClusterId: 0 },
    { id: "edge3", source: "node1", target: "node3", isIntraCluster: true, sourceClusterId: 0, targetClusterId: 0 },
    { id: "edge4", source: "node4", target: "node5", isIntraCluster: true, sourceClusterId: 1, targetClusterId: 1 },
    { id: "edge5", source: "node3", target: "node4", isIntraCluster: false, sourceClusterId: 0, targetClusterId: 1 },
  ];

  const communities: Community[] = [
    { id: 0, size: 3, members: ["node1", "node2", "node3"], internalWeight: 3, totalDegree: 7, color: "#1f77b4", label: "Cluster 1" },
    { id: 1, size: 2, members: ["node4", "node5"], internalWeight: 1, totalDegree: 3, color: "#ff7f0e", label: "Cluster 2" },
  ];

  return {
    nodes,
    edges,
    communities,
    modularity: 0.65,
  };
}

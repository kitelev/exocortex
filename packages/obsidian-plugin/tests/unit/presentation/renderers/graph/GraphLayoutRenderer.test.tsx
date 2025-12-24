/**
 * GraphLayoutRenderer Unit Tests
 *
 * Tests for the GraphLayoutRenderer component including:
 * - Basic rendering
 * - Node and edge rendering
 * - Empty state handling
 * - Click handlers
 * - Zoom controls
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// D3 is mocked via moduleNameMapper in jest.config.js -> tests/__mocks__/d3.ts
// Import the mocked functions to setup before each test
import * as d3Mock from "d3";
import { GraphLayoutRenderer } from "@plugin/presentation/renderers/graph/GraphLayoutRenderer";

// Create mock factories for D3 force simulation
const createMockSimulation = () => {
  const simulation: Record<string, jest.Mock> = {};
  simulation.force = jest.fn().mockReturnValue(simulation);
  simulation.on = jest.fn((event: string, handler?: () => void) => {
    if (event === "tick" && handler) {
      setTimeout(() => handler(), 0);
    }
    return simulation;
  });
  simulation.stop = jest.fn();
  simulation.alpha = jest.fn().mockReturnValue(simulation);
  simulation.alphaTarget = jest.fn().mockReturnValue(simulation);
  simulation.restart = jest.fn();
  return simulation;
};

const createMockForceLink = () => {
  const link: Record<string, jest.Mock> = {};
  link.id = jest.fn().mockReturnValue(link);
  link.distance = jest.fn().mockReturnValue(link);
  return link;
};

const createMockForceManyBody = () => {
  const force: Record<string, jest.Mock> = {};
  force.strength = jest.fn().mockReturnValue(force);
  force.distanceMin = jest.fn().mockReturnValue(force);
  force.distanceMax = jest.fn().mockReturnValue(force);
  return force;
};

const createMockForceCollide = () => {
  const force: Record<string, jest.Mock> = {};
  force.radius = jest.fn().mockReturnValue(force);
  return force;
};

const createMockSelection = () => {
  const selection: Record<string, jest.Mock> = {};
  selection.call = jest.fn().mockReturnValue(selection);
  selection.on = jest.fn().mockReturnValue(selection);
  selection.transition = jest.fn().mockReturnValue(selection);
  selection.duration = jest.fn().mockReturnValue(selection);
  return selection;
};

const createMockZoom = () => {
  const zoomBehavior: Record<string, jest.Mock | object> = {};
  zoomBehavior.scaleExtent = jest.fn().mockReturnValue(zoomBehavior);
  zoomBehavior.on = jest.fn().mockReturnValue(zoomBehavior);
  zoomBehavior.transform = {};
  zoomBehavior.scaleBy = {};
  return zoomBehavior;
};

// Restore mock implementations before each test (since resetMocks: true clears them)
beforeEach(() => {
  (d3Mock.forceSimulation as jest.Mock).mockImplementation(() => createMockSimulation());
  (d3Mock.forceLink as jest.Mock).mockImplementation(() => createMockForceLink());
  (d3Mock.forceManyBody as jest.Mock).mockImplementation(() => createMockForceManyBody());
  (d3Mock.forceCenter as jest.Mock).mockImplementation(() => {});
  (d3Mock.forceCollide as jest.Mock).mockImplementation(() => createMockForceCollide());
  (d3Mock.zoom as jest.Mock).mockImplementation(() => createMockZoom());
  (d3Mock.select as jest.Mock).mockImplementation(() => createMockSelection());
});
import type {
  GraphNode,
  GraphEdge,
} from "@plugin/presentation/renderers/graph/types";

// Mock ResizeObserver
class MockResizeObserver {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
}

global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

describe("GraphLayoutRenderer", () => {
  // Test fixtures
  const createLayout = (
    overrides: Partial<Parameters<typeof GraphLayoutRenderer>[0]["layout"]> = {}
  ) => ({
    uid: "graph-1",
    label: "Test Graph",
    nodeLabel: "[[exo__Asset_label]]",
    edgeProperties: ["[[ems__Task_parent]]"],
    depth: 1,
    ...overrides,
  });

  const createNode = (overrides: Partial<GraphNode> = {}): GraphNode => ({
    id: "node-1",
    label: "Test Node",
    path: "/path/to/asset.md",
    ...overrides,
  });

  const createEdge = (overrides: Partial<GraphEdge> = {}): GraphEdge => ({
    id: "edge-1",
    source: "node-1",
    target: "node-2",
    label: "relates to",
    ...overrides,
  });

  describe("Basic Rendering", () => {
    it("renders a graph container with header", () => {
      const layout = createLayout();
      const nodes = [createNode()];
      const edges: GraphEdge[] = [];

      render(
        <GraphLayoutRenderer
          layout={layout}
          nodes={nodes}
          edges={edges}
        />
      );

      expect(screen.getByText("Test Graph")).toBeInTheDocument();
    });

    it("displays node and edge counts", () => {
      const layout = createLayout();
      const nodes = [
        createNode({ id: "n1" }),
        createNode({ id: "n2" }),
        createNode({ id: "n3" }),
      ];
      const edges = [
        createEdge({ id: "e1", source: "n1", target: "n2" }),
      ];

      render(
        <GraphLayoutRenderer
          layout={layout}
          nodes={nodes}
          edges={edges}
        />
      );

      expect(screen.getByText("3 nodes, 1 edge")).toBeInTheDocument();
    });

    it("renders SVG element", () => {
      const layout = createLayout();
      const nodes = [createNode()];
      const edges: GraphEdge[] = [];

      const { container } = render(
        <GraphLayoutRenderer
          layout={layout}
          nodes={nodes}
          edges={edges}
        />
      );

      const svg = container.querySelector("svg.exo-graph-svg");
      expect(svg).toBeInTheDocument();
    });

    it("renders nodes in SVG", async () => {
      const layout = createLayout();
      const nodes = [
        createNode({ id: "n1", label: "Node 1" }),
        createNode({ id: "n2", label: "Node 2" }),
      ];
      const edges: GraphEdge[] = [];

      const { container } = render(
        <GraphLayoutRenderer
          layout={layout}
          nodes={nodes}
          edges={edges}
        />
      );

      await waitFor(() => {
        const nodeElements = container.querySelectorAll("g.exo-graph-node");
        expect(nodeElements.length).toBe(2);
      });
    });

    it("renders edges in SVG", async () => {
      const layout = createLayout();
      const nodes = [
        createNode({ id: "n1" }),
        createNode({ id: "n2" }),
      ];
      const edges = [
        createEdge({ id: "e1", source: "n1", target: "n2" }),
      ];

      const { container } = render(
        <GraphLayoutRenderer
          layout={layout}
          nodes={nodes}
          edges={edges}
        />
      );

      await waitFor(() => {
        const edgeElements = container.querySelectorAll("g.exo-graph-edge");
        expect(edgeElements.length).toBe(1);
      });
    });
  });

  describe("Empty State", () => {
    it("renders empty message when no nodes", () => {
      const layout = createLayout();
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      render(
        <GraphLayoutRenderer
          layout={layout}
          nodes={nodes}
          edges={edges}
        />
      );

      expect(screen.getByText(/no nodes to display/i)).toBeInTheDocument();
    });

    it("still renders header in empty state", () => {
      const layout = createLayout({ label: "Empty Graph" });
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      render(
        <GraphLayoutRenderer
          layout={layout}
          nodes={nodes}
          edges={edges}
        />
      );

      expect(screen.getByText("Empty Graph")).toBeInTheDocument();
    });

    it("applies empty class to container", () => {
      const layout = createLayout();
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      const { container } = render(
        <GraphLayoutRenderer
          layout={layout}
          nodes={nodes}
          edges={edges}
        />
      );

      expect(container.firstChild).toHaveClass("exo-graph-empty");
    });
  });

  describe("Click Handlers", () => {
    it("calls onNodeClick when node is clicked", async () => {
      const onNodeClick = jest.fn();
      const layout = createLayout();
      const nodes = [createNode({ id: "n1", path: "/path/to/node.md" })];
      const edges: GraphEdge[] = [];

      const { container } = render(
        <GraphLayoutRenderer
          layout={layout}
          nodes={nodes}
          edges={edges}
          onNodeClick={onNodeClick}
        />
      );

      await waitFor(() => {
        const nodeElement = container.querySelector('[data-node-id="n1"]');
        expect(nodeElement).toBeInTheDocument();
      });

      const nodeElement = container.querySelector('[data-node-id="n1"]');
      fireEvent.click(nodeElement!);

      expect(onNodeClick).toHaveBeenCalledWith(
        "n1",
        "/path/to/node.md",
        expect.any(Object)
      );
    });

    it("calls onEdgeClick when edge is clicked", async () => {
      const onEdgeClick = jest.fn();
      const layout = createLayout();
      const nodes = [
        createNode({ id: "n1" }),
        createNode({ id: "n2" }),
      ];
      const edges = [createEdge({ id: "e1", source: "n1", target: "n2" })];

      const { container } = render(
        <GraphLayoutRenderer
          layout={layout}
          nodes={nodes}
          edges={edges}
          onEdgeClick={onEdgeClick}
        />
      );

      await waitFor(() => {
        const edgeElement = container.querySelector('[data-edge-id="e1"]');
        expect(edgeElement).toBeInTheDocument();
      });

      const edgeElement = container.querySelector('[data-edge-id="e1"]');
      fireEvent.click(edgeElement!);

      expect(onEdgeClick).toHaveBeenCalledWith("e1", expect.any(Object));
    });
  });

  describe("Zoom Controls", () => {
    it("renders zoom controls when zoomable is true", () => {
      const layout = createLayout();
      const nodes = [createNode()];
      const edges: GraphEdge[] = [];

      const { container } = render(
        <GraphLayoutRenderer
          layout={layout}
          nodes={nodes}
          edges={edges}
          options={{ zoomable: true }}
        />
      );

      const controls = container.querySelector(".exo-graph-controls");
      expect(controls).toBeInTheDocument();

      const buttons = controls?.querySelectorAll("button");
      expect(buttons?.length).toBe(3); // zoom in, zoom out, reset
    });

    it("does not render zoom controls when zoomable is false", () => {
      const layout = createLayout();
      const nodes = [createNode()];
      const edges: GraphEdge[] = [];

      const { container } = render(
        <GraphLayoutRenderer
          layout={layout}
          nodes={nodes}
          edges={edges}
          options={{ zoomable: false }}
        />
      );

      const controls = container.querySelector(".exo-graph-controls");
      expect(controls).not.toBeInTheDocument();
    });

    it("has accessible zoom button titles", () => {
      const layout = createLayout();
      const nodes = [createNode()];
      const edges: GraphEdge[] = [];

      const { container } = render(
        <GraphLayoutRenderer
          layout={layout}
          nodes={nodes}
          edges={edges}
          options={{ zoomable: true }}
        />
      );

      expect(container.querySelector('[title="Zoom in"]')).toBeInTheDocument();
      expect(container.querySelector('[title="Zoom out"]')).toBeInTheDocument();
      expect(container.querySelector('[title="Reset zoom"]')).toBeInTheDocument();
    });
  });

  describe("Custom className", () => {
    it("applies custom className to container", () => {
      const layout = createLayout();
      const nodes = [createNode()];
      const edges: GraphEdge[] = [];

      const { container } = render(
        <GraphLayoutRenderer
          layout={layout}
          nodes={nodes}
          edges={edges}
          className="custom-class"
        />
      );

      expect(container.firstChild).toHaveClass("custom-class");
    });
  });

  describe("Options", () => {
    it("respects custom height option", () => {
      const layout = createLayout();
      const nodes = [createNode()];
      const edges: GraphEdge[] = [];

      const { container } = render(
        <GraphLayoutRenderer
          layout={layout}
          nodes={nodes}
          edges={edges}
          options={{ height: 500 }}
        />
      );

      const graphContainer = container.querySelector(".exo-graph-container");
      expect(graphContainer).toHaveStyle({ height: "500px" });
    });

    it("respects showLabels option", async () => {
      const layout = createLayout();
      const nodes = [createNode({ id: "n1", label: "My Label" })];
      const edges: GraphEdge[] = [];

      const { container } = render(
        <GraphLayoutRenderer
          layout={layout}
          nodes={nodes}
          edges={edges}
          options={{ showLabels: true }}
        />
      );

      await waitFor(() => {
        const labels = container.querySelectorAll("text.exo-graph-node-label");
        expect(labels.length).toBeGreaterThan(0);
      });
    });

    it("hides labels when showLabels is false", async () => {
      const layout = createLayout();
      const nodes = [createNode({ id: "n1", label: "My Label" })];
      const edges: GraphEdge[] = [];

      const { container } = render(
        <GraphLayoutRenderer
          layout={layout}
          nodes={nodes}
          edges={edges}
          options={{ showLabels: false }}
        />
      );

      await waitFor(() => {
        const nodeElements = container.querySelectorAll("g.exo-graph-node");
        expect(nodeElements.length).toBe(1);
      });

      const labels = container.querySelectorAll("text.exo-graph-node-label");
      expect(labels.length).toBe(0);
    });

    it("uses custom nodeColor function", async () => {
      const layout = createLayout();
      const nodes = [
        createNode({ id: "n1", group: "typeA" }),
        createNode({ id: "n2", group: "typeB" }),
      ];
      const edges: GraphEdge[] = [];

      const nodeColor = (node: GraphNode) =>
        node.group === "typeA" ? "#ff0000" : "#0000ff";

      const { container } = render(
        <GraphLayoutRenderer
          layout={layout}
          nodes={nodes}
          edges={edges}
          options={{ nodeColor }}
        />
      );

      await waitFor(() => {
        const nodeElements = container.querySelectorAll("g.exo-graph-node");
        expect(nodeElements.length).toBe(2);
      });
    });
  });

  describe("Arrowhead Marker", () => {
    it("defines arrowhead marker in SVG defs", () => {
      const layout = createLayout();
      const nodes = [createNode()];
      const edges: GraphEdge[] = [];

      const { container } = render(
        <GraphLayoutRenderer
          layout={layout}
          nodes={nodes}
          edges={edges}
        />
      );

      const marker = container.querySelector("marker#arrowhead");
      expect(marker).toBeInTheDocument();
    });
  });

  describe("Pluralization", () => {
    it("uses singular 'node' for 1 node", () => {
      const layout = createLayout();
      const nodes = [createNode()];
      const edges: GraphEdge[] = [];

      render(
        <GraphLayoutRenderer
          layout={layout}
          nodes={nodes}
          edges={edges}
        />
      );

      expect(screen.getByText("1 node, 0 edges")).toBeInTheDocument();
    });

    it("uses singular 'edge' for 1 edge", () => {
      const layout = createLayout();
      const nodes = [
        createNode({ id: "n1" }),
        createNode({ id: "n2" }),
      ];
      const edges = [createEdge({ source: "n1", target: "n2" })];

      render(
        <GraphLayoutRenderer
          layout={layout}
          nodes={nodes}
          edges={edges}
        />
      );

      expect(screen.getByText("2 nodes, 1 edge")).toBeInTheDocument();
    });
  });
});

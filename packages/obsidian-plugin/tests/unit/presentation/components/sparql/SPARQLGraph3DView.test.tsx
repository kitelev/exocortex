/**
 * SPARQLGraph3DView Unit Tests
 *
 * Tests for the SPARQLGraph3DView component.
 * Since Three.js requires WebGL context (not available in JSDOM),
 * we test module exports, convertTo3DData utility, and empty state rendering.
 */

import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { GraphData } from "exocortex";

// Create mock class factories - called fresh in beforeEach to survive resetMocks
const createSceneManagerMock = () => ({
  initialize: jest.fn(),
  setNodes: jest.fn(),
  setEdges: jest.fn(),
  updatePositions: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
  destroy: jest.fn(),
  fitToView: jest.fn(),
  isInitialized: jest.fn().mockReturnValue(true),
});

const createSimulationMock = () => ({
  on: jest.fn(),
  off: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
  destroy: jest.fn(),
  getNodes: jest.fn().mockReturnValue([]),
  setData: jest.fn(),
});

// Store the mock instances for access in tests
let sceneManagerInstance: ReturnType<typeof createSceneManagerMock>;
let simulationInstance: ReturnType<typeof createSimulationMock>;

// Mock the 3D infrastructure since WebGL is not available in JSDOM
// Note: Due to resetMocks: true in jest.config.js, we must re-establish
// mockImplementation in beforeEach
jest.mock("@plugin/presentation/renderers/graph/3d/Scene3DManager");
jest.mock("@plugin/presentation/renderers/graph/3d/ForceSimulation3D");

// Import component after mocking
import { SPARQLGraph3DView, convertTo3DData } from "../../../../../src/presentation/components/sparql/SPARQLGraph3DView";
import { Scene3DManager } from "@plugin/presentation/renderers/graph/3d/Scene3DManager";
import { ForceSimulation3D } from "@plugin/presentation/renderers/graph/3d/ForceSimulation3D";

describe("SPARQLGraph3DView", () => {
  beforeEach(() => {
    cleanup();

    // Re-establish mock implementations after resetMocks clears them
    (Scene3DManager as jest.Mock).mockImplementation(() => {
      sceneManagerInstance = createSceneManagerMock();
      return sceneManagerInstance;
    });

    (ForceSimulation3D as jest.Mock).mockImplementation(() => {
      simulationInstance = createSimulationMock();
      return simulationInstance;
    });
  });

  describe("module exports", () => {
    it("exports SPARQLGraph3DView component", () => {
      expect(SPARQLGraph3DView).toBeDefined();
      expect(typeof SPARQLGraph3DView).toBe("function");
    });

    it("exports convertTo3DData utility function", () => {
      expect(convertTo3DData).toBeDefined();
      expect(typeof convertTo3DData).toBe("function");
    });
  });

  describe("convertTo3DData utility", () => {
    it("converts empty graph data to empty 3D data", () => {
      const emptyGraphData: GraphData = { nodes: [], edges: [] };
      const result = convertTo3DData(emptyGraphData);

      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });

    it("converts nodes with correct properties", () => {
      const graphData: GraphData = {
        nodes: [
          {
            id: "node1",
            path: "http://example.org/node1",
            title: "Node 1",
            label: "Node 1 Label",
            isArchived: false,
            properties: { foo: "bar" },
          },
          {
            id: "node2",
            path: "http://example.org/node2",
            title: "Node 2",
            label: "Node 2 Label",
            isArchived: false,
          },
        ],
        edges: [],
      };

      const result = convertTo3DData(graphData);

      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[0]).toEqual({
        id: "http://example.org/node1",
        label: "Node 1 Label",
        path: "http://example.org/node1",
        metadata: { foo: "bar" },
      });
      expect(result.nodes[1]).toEqual({
        id: "http://example.org/node2",
        label: "Node 2 Label",
        path: "http://example.org/node2",
        metadata: undefined,
      });
    });

    it("converts edges with generated IDs", () => {
      const graphData: GraphData = {
        nodes: [
          { id: "node1", path: "http://example.org/node1", title: "Node 1", label: "Node 1", isArchived: false },
          { id: "node2", path: "http://example.org/node2", title: "Node 2", label: "Node 2", isArchived: false },
        ],
        edges: [
          { source: "http://example.org/node1", target: "http://example.org/node2", type: "forward-link", label: "connects" },
          { source: "http://example.org/node2", target: "http://example.org/node1", type: "forward-link" },
        ],
      };

      const result = convertTo3DData(graphData);

      expect(result.edges).toHaveLength(2);
      expect(result.edges[0]).toEqual({
        id: "edge-0",
        source: "http://example.org/node1",
        target: "http://example.org/node2",
        label: "connects",
      });
      expect(result.edges[1]).toEqual({
        id: "edge-1",
        source: "http://example.org/node2",
        target: "http://example.org/node1",
        label: undefined,
      });
    });

    it("handles nodes without optional properties", () => {
      const graphData: GraphData = {
        nodes: [
          {
            id: "minimal",
            path: "http://example.org/minimal",
            title: "Minimal Node",
            label: "Minimal",
            isArchived: false,
          },
        ],
        edges: [],
      };

      const result = convertTo3DData(graphData);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].metadata).toBeUndefined();
    });
  });

  describe("empty state rendering", () => {
    it("displays empty state message when triples array is empty", () => {
      const mockOnAssetClick = jest.fn();

      render(
        <SPARQLGraph3DView
          triples={[]}
          onAssetClick={mockOnAssetClick}
        />
      );

      expect(screen.getByText("No results to visualize")).toBeInTheDocument();
      expect(screen.getByTestId("sparql-graph3d-empty")).toBeInTheDocument();
    });

    it("displays empty state when triples contain no IRI nodes", () => {
      const mockOnAssetClick = jest.fn();

      // Triple with literal subject/object won't produce nodes
      const triplesWithLiteralsOnly = [
        {
          subject: { toString: () => '"literal"' },
          predicate: { toString: () => "<http://example.org/predicate>" },
          object: { toString: () => '"value"' },
          toString: () => '"literal" <http://example.org/predicate> "value" .',
        },
      ];

      render(
        <SPARQLGraph3DView
          triples={triplesWithLiteralsOnly as any}
          onAssetClick={mockOnAssetClick}
        />
      );

      expect(screen.getByText("No results to visualize")).toBeInTheDocument();
    });

    it("empty state container has correct styling classes", () => {
      const mockOnAssetClick = jest.fn();

      render(
        <SPARQLGraph3DView
          triples={[]}
          onAssetClick={mockOnAssetClick}
        />
      );

      const container = screen.getByTestId("sparql-graph3d-empty");
      expect(container).toHaveClass("sparql-graph3d-view");
      expect(container).toHaveClass("sparql-graph3d-view-empty");
    });

    it("does NOT initialize Scene3DManager when triples are empty", () => {
      const mockOnAssetClick = jest.fn();

      render(
        <SPARQLGraph3DView
          triples={[]}
          onAssetClick={mockOnAssetClick}
        />
      );

      expect(Scene3DManager).not.toHaveBeenCalled();
    });

    it("does NOT initialize ForceSimulation3D when triples are empty", () => {
      const mockOnAssetClick = jest.fn();

      render(
        <SPARQLGraph3DView
          triples={[]}
          onAssetClick={mockOnAssetClick}
        />
      );

      expect(ForceSimulation3D).not.toHaveBeenCalled();
    });
  });

  describe("component with valid triples", () => {
    const createValidTriples = () => [
      {
        subject: { toString: () => "<http://example.org/node1>" },
        predicate: { toString: () => "<http://example.org/connects>" },
        object: { toString: () => "<http://example.org/node2>" },
        toString: () => "<http://example.org/node1> <http://example.org/connects> <http://example.org/node2> .",
      },
    ];

    it("renders canvas container when valid triples are provided", () => {
      const mockOnAssetClick = jest.fn();

      render(
        <SPARQLGraph3DView
          triples={createValidTriples() as any}
          onAssetClick={mockOnAssetClick}
        />
      );

      expect(screen.getByTestId("sparql-graph3d-canvas")).toBeInTheDocument();
      expect(screen.queryByText("No results to visualize")).not.toBeInTheDocument();
    });

    it("canvas container has correct class", () => {
      const mockOnAssetClick = jest.fn();

      render(
        <SPARQLGraph3DView
          triples={createValidTriples() as any}
          onAssetClick={mockOnAssetClick}
        />
      );

      const canvas = screen.getByTestId("sparql-graph3d-canvas");
      expect(canvas).toHaveClass("sparql-graph3d-view");
    });

    it("canvas container has correct height styling", () => {
      const mockOnAssetClick = jest.fn();

      render(
        <SPARQLGraph3DView
          triples={createValidTriples() as any}
          onAssetClick={mockOnAssetClick}
        />
      );

      const canvas = screen.getByTestId("sparql-graph3d-canvas");
      expect(canvas).toHaveStyle({ height: "600px" });
    });

    it("initializes Scene3DManager when valid triples are provided", () => {
      render(
        <SPARQLGraph3DView
          triples={createValidTriples() as any}
          onAssetClick={jest.fn()}
        />
      );

      expect(Scene3DManager).toHaveBeenCalled();
      expect(sceneManagerInstance.initialize).toHaveBeenCalled();
    });

    it("initializes ForceSimulation3D when valid triples are provided", () => {
      render(
        <SPARQLGraph3DView
          triples={createValidTriples() as any}
          onAssetClick={jest.fn()}
        />
      );

      expect(ForceSimulation3D).toHaveBeenCalled();
    });

    it("sets nodes and edges on Scene3DManager", () => {
      render(
        <SPARQLGraph3DView
          triples={createValidTriples() as any}
          onAssetClick={jest.fn()}
        />
      );

      expect(sceneManagerInstance.setNodes).toHaveBeenCalled();
      expect(sceneManagerInstance.setEdges).toHaveBeenCalled();
    });

    it("starts force simulation", () => {
      render(
        <SPARQLGraph3DView
          triples={createValidTriples() as any}
          onAssetClick={jest.fn()}
        />
      );

      expect(simulationInstance.start).toHaveBeenCalled();
    });

    it("registers nodeClick event handler on Scene3DManager", () => {
      render(
        <SPARQLGraph3DView
          triples={createValidTriples() as any}
          onAssetClick={jest.fn()}
        />
      );

      expect(sceneManagerInstance.on).toHaveBeenCalledWith("nodeClick", expect.any(Function));
    });

    it("registers tick event handler on ForceSimulation3D", () => {
      render(
        <SPARQLGraph3DView
          triples={createValidTriples() as any}
          onAssetClick={jest.fn()}
        />
      );

      expect(simulationInstance.on).toHaveBeenCalledWith("tick", expect.any(Function));
    });
  });

  describe("cleanup on unmount", () => {
    const createValidTriples = () => [
      {
        subject: { toString: () => "<http://example.org/node1>" },
        predicate: { toString: () => "<http://example.org/connects>" },
        object: { toString: () => "<http://example.org/node2>" },
        toString: () => "<http://example.org/node1> <http://example.org/connects> <http://example.org/node2> .",
      },
    ];

    it("destroys Scene3DManager when component unmounts", () => {
      const { unmount } = render(
        <SPARQLGraph3DView
          triples={createValidTriples() as any}
          onAssetClick={jest.fn()}
        />
      );

      unmount();

      expect(sceneManagerInstance.destroy).toHaveBeenCalled();
    });

    it("destroys ForceSimulation3D when component unmounts", () => {
      const { unmount } = render(
        <SPARQLGraph3DView
          triples={createValidTriples() as any}
          onAssetClick={jest.fn()}
        />
      );

      unmount();

      expect(simulationInstance.destroy).toHaveBeenCalled();
    });

    it("does not attempt cleanup when no WebGL context was created (empty triples)", () => {
      const { unmount } = render(
        <SPARQLGraph3DView
          triples={[]}
          onAssetClick={jest.fn()}
        />
      );

      unmount();

      // Scene3DManager and ForceSimulation3D were never created
      expect(Scene3DManager).not.toHaveBeenCalled();
      expect(ForceSimulation3D).not.toHaveBeenCalled();
    });
  });

  describe("onAssetClick callback", () => {
    const createValidTriples = () => [
      {
        subject: { toString: () => "<http://example.org/node1>" },
        predicate: { toString: () => "<http://example.org/connects>" },
        object: { toString: () => "<http://example.org/node2>" },
        toString: () => "<http://example.org/node1> <http://example.org/connects> <http://example.org/node2> .",
      },
    ];

    it("calls onAssetClick when nodeClick event fires with a node", () => {
      const mockOnAssetClick = jest.fn();

      render(
        <SPARQLGraph3DView
          triples={createValidTriples() as any}
          onAssetClick={mockOnAssetClick}
        />
      );

      // Find the registered nodeClick handler
      const nodeClickHandler = sceneManagerInstance.on.mock.calls.find(
        (call: [string, Function]) => call[0] === "nodeClick"
      )?.[1];

      expect(nodeClickHandler).toBeDefined();

      // Simulate a node click event
      nodeClickHandler({
        type: "nodeClick",
        node: { path: "http://example.org/clicked-node" },
      });

      expect(mockOnAssetClick).toHaveBeenCalledWith("http://example.org/clicked-node");
    });

    it("does not call onAssetClick when nodeClick event has no node", () => {
      const mockOnAssetClick = jest.fn();

      render(
        <SPARQLGraph3DView
          triples={createValidTriples() as any}
          onAssetClick={mockOnAssetClick}
        />
      );

      // Find the registered nodeClick handler
      const nodeClickHandler = sceneManagerInstance.on.mock.calls.find(
        (call: [string, Function]) => call[0] === "nodeClick"
      )?.[1];

      // Simulate a nodeClick event without a node
      nodeClickHandler({ type: "nodeClick" });

      expect(mockOnAssetClick).not.toHaveBeenCalled();
    });
  });
});

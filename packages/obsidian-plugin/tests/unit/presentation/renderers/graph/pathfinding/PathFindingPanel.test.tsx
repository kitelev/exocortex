/**
 * PathFindingPanel Tests
 *
 * Tests for the PathFindingPanel React component.
 *
 * @module tests/presentation/renderers/graph/pathfinding
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  PathFindingPanel,
  PathFindingButton,
} from "../../../../../../src/presentation/renderers/graph/pathfinding/PathFindingPanel";
import type { PathFindingState } from "../../../../../../src/presentation/renderers/graph/pathfinding/PathFindingTypes";
import {
  INITIAL_PATH_FINDING_STATE,
  DEFAULT_PATH_FINDING_OPTIONS,
} from "../../../../../../src/presentation/renderers/graph/pathfinding/PathFindingTypes";

describe("PathFindingPanel", () => {
  // Default props for testing
  const createDefaultProps = () => ({
    state: { ...INITIAL_PATH_FINDING_STATE },
    onStart: jest.fn(),
    onCancel: jest.fn(),
    onClear: jest.fn(),
    onSwapNodes: jest.fn(),
    onNextPath: jest.fn(),
    onPreviousPath: jest.fn(),
    onSelectPath: jest.fn(),
    onOptionsChange: jest.fn(),
  });

  describe("Inactive state", () => {
    it("should render start button when inactive", () => {
      const props = createDefaultProps();

      render(<PathFindingPanel {...props} />);

      expect(screen.getByText("Find Path")).toBeInTheDocument();
    });

    it("should call onStart when start button clicked", () => {
      const props = createDefaultProps();

      render(<PathFindingPanel {...props} />);
      fireEvent.click(screen.getByText("Find Path"));

      expect(props.onStart).toHaveBeenCalledTimes(1);
    });

    it("should apply custom className", () => {
      const props = createDefaultProps();

      const { container } = render(
        <PathFindingPanel {...props} className="custom-class" />
      );

      expect(container.firstChild).toHaveClass("custom-class");
    });
  });

  describe("Active state - Source selection", () => {
    it("should show selection UI when active", () => {
      const props = createDefaultProps();
      props.state = {
        ...INITIAL_PATH_FINDING_STATE,
        isActive: true,
        selectionStep: "source",
      };

      render(<PathFindingPanel {...props} />);

      expect(screen.getByText("Path Finding")).toBeInTheDocument();
      expect(screen.getByText("Source:")).toBeInTheDocument();
      expect(screen.getByText("Target:")).toBeInTheDocument();
    });

    it("should show 'Click a node...' for unselected nodes", () => {
      const props = createDefaultProps();
      props.state = {
        ...INITIAL_PATH_FINDING_STATE,
        isActive: true,
        selectionStep: "source",
      };

      render(<PathFindingPanel {...props} />);

      const clickPrompts = screen.getAllByText("Click a node...");
      expect(clickPrompts).toHaveLength(2);
    });

    it("should call onCancel when close button clicked", () => {
      const props = createDefaultProps();
      props.state = {
        ...INITIAL_PATH_FINDING_STATE,
        isActive: true,
      };

      render(<PathFindingPanel {...props} />);
      fireEvent.click(screen.getByTitle("Cancel path finding"));

      expect(props.onCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe("Active state - Nodes selected", () => {
    it("should display selected source node label", () => {
      const props = createDefaultProps();
      props.state = {
        ...INITIAL_PATH_FINDING_STATE,
        isActive: true,
        selectionStep: "target",
        sourceNode: { id: "A", label: "Node A", path: "/A.md" },
      };

      render(<PathFindingPanel {...props} />);

      expect(screen.getByText("Node A")).toBeInTheDocument();
    });

    it("should display selected target node label", () => {
      const props = createDefaultProps();
      props.state = {
        ...INITIAL_PATH_FINDING_STATE,
        isActive: true,
        selectionStep: "complete",
        sourceNode: { id: "A", label: "Node A", path: "/A.md" },
        targetNode: { id: "D", label: "Node D", path: "/D.md" },
      };

      render(<PathFindingPanel {...props} />);

      expect(screen.getByText("Node A")).toBeInTheDocument();
      expect(screen.getByText("Node D")).toBeInTheDocument();
    });

    it("should show swap button when both nodes selected", () => {
      const props = createDefaultProps();
      props.state = {
        ...INITIAL_PATH_FINDING_STATE,
        isActive: true,
        selectionStep: "complete",
        sourceNode: { id: "A", label: "Node A", path: "/A.md" },
        targetNode: { id: "D", label: "Node D", path: "/D.md" },
      };

      render(<PathFindingPanel {...props} />);

      expect(screen.getByTitle("Swap source and target")).toBeInTheDocument();
    });

    it("should call onSwapNodes when swap button clicked", () => {
      const props = createDefaultProps();
      props.state = {
        ...INITIAL_PATH_FINDING_STATE,
        isActive: true,
        selectionStep: "complete",
        sourceNode: { id: "A", label: "Node A", path: "/A.md" },
        targetNode: { id: "D", label: "Node D", path: "/D.md" },
      };

      render(<PathFindingPanel {...props} />);
      fireEvent.click(screen.getByTitle("Swap source and target"));

      expect(props.onSwapNodes).toHaveBeenCalledTimes(1);
    });
  });

  describe("Searching state", () => {
    it("should show searching indicator", () => {
      const props = createDefaultProps();
      props.state = {
        ...INITIAL_PATH_FINDING_STATE,
        isActive: true,
        isSearching: true,
        sourceNode: { id: "A", label: "Node A", path: "/A.md" },
        targetNode: { id: "D", label: "Node D", path: "/D.md" },
      };

      render(<PathFindingPanel {...props} />);

      expect(screen.getByText("Searching...")).toBeInTheDocument();
    });
  });

  describe("Path found state", () => {
    const createFoundState = (): PathFindingState => ({
      ...INITIAL_PATH_FINDING_STATE,
      isActive: true,
      selectionStep: "complete",
      sourceNode: { id: "A", label: "Node A", path: "/A.md" },
      targetNode: { id: "D", label: "Node D", path: "/D.md" },
      result: {
        found: true,
        paths: [
          {
            id: "path-1",
            source: { id: "A", label: "Node A", path: "/A.md" },
            target: { id: "D", label: "Node D", path: "/D.md" },
            steps: [
              { node: { id: "A", label: "Node A", path: "/A.md" }, edge: null, isReverse: false, cumulativeWeight: 0 },
              { node: { id: "B", label: "Node B", path: "/B.md" }, edge: { id: "e1", source: "A", target: "B" }, isReverse: false, cumulativeWeight: 1 },
              { node: { id: "C", label: "Node C", path: "/C.md" }, edge: { id: "e2", source: "B", target: "C" }, isReverse: false, cumulativeWeight: 2 },
              { node: { id: "D", label: "Node D", path: "/D.md" }, edge: { id: "e3", source: "C", target: "D" }, isReverse: false, cumulativeWeight: 3 },
            ],
            totalWeight: 3,
            length: 3,
            nodeIds: ["A", "B", "C", "D"],
            edgeIds: ["e1", "e2", "e3"],
          },
        ],
        sourceId: "A",
        targetId: "D",
        algorithm: "bfs",
        nodesVisited: 4,
        searchTimeMs: 1.5,
        timedOut: false,
      },
      currentPathIndex: 0,
    });

    it("should show path found message", () => {
      const props = createDefaultProps();
      props.state = createFoundState();

      render(<PathFindingPanel {...props} />);

      expect(screen.getByText(/Path found/)).toBeInTheDocument();
    });

    it("should show path length", () => {
      const props = createDefaultProps();
      props.state = createFoundState();

      render(<PathFindingPanel {...props} />);

      expect(screen.getByText(/3 edges/)).toBeInTheDocument();
    });

    it("should show path steps", () => {
      const props = createDefaultProps();
      props.state = createFoundState();

      render(<PathFindingPanel {...props} />);

      // Path steps container should have all nodes
      // Use getAllByText since "Node A" and "Node D" appear in both selection slots and path
      const nodeAs = screen.getAllByText("Node A");
      const nodeBs = screen.getAllByText("Node B");
      const nodeCs = screen.getAllByText("Node C");
      const nodeDs = screen.getAllByText("Node D");

      // Source/target labels + path steps = 2 instances each for A and D
      expect(nodeAs.length).toBeGreaterThanOrEqual(1);
      expect(nodeBs.length).toBeGreaterThanOrEqual(1);
      expect(nodeCs.length).toBeGreaterThanOrEqual(1);
      expect(nodeDs.length).toBeGreaterThanOrEqual(1);
    });

    it("should show clear button", () => {
      const props = createDefaultProps();
      props.state = createFoundState();

      render(<PathFindingPanel {...props} />);

      expect(screen.getByText("Clear Path")).toBeInTheDocument();
    });

    it("should call onClear when clear button clicked", () => {
      const props = createDefaultProps();
      props.state = createFoundState();

      render(<PathFindingPanel {...props} />);
      fireEvent.click(screen.getByText("Clear Path"));

      expect(props.onClear).toHaveBeenCalledTimes(1);
    });
  });

  describe("Path not found state", () => {
    it("should show not found message", () => {
      const props = createDefaultProps();
      props.state = {
        ...INITIAL_PATH_FINDING_STATE,
        isActive: true,
        selectionStep: "complete",
        sourceNode: { id: "A", label: "Node A", path: "/A.md" },
        targetNode: { id: "D", label: "Node D", path: "/D.md" },
        result: {
          found: false,
          paths: [],
          sourceId: "A",
          targetId: "D",
          algorithm: "bfs",
          nodesVisited: 5,
          searchTimeMs: 2.3,
          timedOut: false,
        },
        currentPathIndex: 0,
      };

      render(<PathFindingPanel {...props} />);

      expect(screen.getByText("No path found")).toBeInTheDocument();
    });

    it("should show search stats", () => {
      const props = createDefaultProps();
      props.state = {
        ...INITIAL_PATH_FINDING_STATE,
        isActive: true,
        selectionStep: "complete",
        sourceNode: { id: "A", label: "Node A", path: "/A.md" },
        targetNode: { id: "D", label: "Node D", path: "/D.md" },
        result: {
          found: false,
          paths: [],
          sourceId: "A",
          targetId: "D",
          algorithm: "bfs",
          nodesVisited: 5,
          searchTimeMs: 2.3,
          timedOut: false,
        },
        currentPathIndex: 0,
      };

      render(<PathFindingPanel {...props} />);

      expect(screen.getByText(/Visited 5 nodes/)).toBeInTheDocument();
    });

    it("should show 'Try Again' button", () => {
      const props = createDefaultProps();
      props.state = {
        ...INITIAL_PATH_FINDING_STATE,
        isActive: true,
        selectionStep: "complete",
        sourceNode: { id: "A", label: "Node A", path: "/A.md" },
        targetNode: { id: "D", label: "Node D", path: "/D.md" },
        result: {
          found: false,
          paths: [],
          sourceId: "A",
          targetId: "D",
          algorithm: "bfs",
          nodesVisited: 5,
          searchTimeMs: 2.3,
          timedOut: false,
        },
        currentPathIndex: 0,
      };

      render(<PathFindingPanel {...props} />);

      expect(screen.getByText("Try Again")).toBeInTheDocument();
    });

    it("should show error message if present", () => {
      const props = createDefaultProps();
      props.state = {
        ...INITIAL_PATH_FINDING_STATE,
        isActive: true,
        selectionStep: "complete",
        sourceNode: { id: "A", label: "Node A", path: "/A.md" },
        targetNode: { id: "D", label: "Node D", path: "/D.md" },
        result: {
          found: false,
          paths: [],
          sourceId: "A",
          targetId: "D",
          algorithm: "bfs",
          nodesVisited: 0,
          searchTimeMs: 0,
          timedOut: true,
          error: "Search timed out",
        },
        currentPathIndex: 0,
      };

      render(<PathFindingPanel {...props} />);

      expect(screen.getByText("Search timed out")).toBeInTheDocument();
    });
  });

  describe("Options panel", () => {
    it("should toggle options panel visibility", () => {
      const props = createDefaultProps();
      props.state = {
        ...INITIAL_PATH_FINDING_STATE,
        isActive: true,
      };

      render(<PathFindingPanel {...props} />);

      // Initially hidden
      expect(screen.queryByLabelText("Algorithm:")).not.toBeInTheDocument();

      // Click to show
      fireEvent.click(screen.getByText(/Show Options/));

      // Now visible
      expect(screen.getByText("Algorithm:")).toBeInTheDocument();
    });

    it("should call onOptionsChange when algorithm changed", () => {
      const props = createDefaultProps();
      props.state = {
        ...INITIAL_PATH_FINDING_STATE,
        isActive: true,
      };

      render(<PathFindingPanel {...props} />);
      fireEvent.click(screen.getByText(/Show Options/));

      const algorithmSelect = screen.getByDisplayValue("BFS (Shortest)");
      fireEvent.change(algorithmSelect, { target: { value: "dijkstra" } });

      expect(props.onOptionsChange).toHaveBeenCalledWith({ algorithm: "dijkstra" });
    });

    it("should call onOptionsChange when direction changed", () => {
      const props = createDefaultProps();
      props.state = {
        ...INITIAL_PATH_FINDING_STATE,
        isActive: true,
      };

      render(<PathFindingPanel {...props} />);
      fireEvent.click(screen.getByText(/Show Options/));

      const directionSelect = screen.getByDisplayValue("Both (Undirected)");
      fireEvent.change(directionSelect, { target: { value: "outgoing" } });

      expect(props.onOptionsChange).toHaveBeenCalledWith({ direction: "outgoing" });
    });

    it("should call onOptionsChange when max length changed", () => {
      const props = createDefaultProps();
      props.state = {
        ...INITIAL_PATH_FINDING_STATE,
        isActive: true,
      };

      render(<PathFindingPanel {...props} />);
      fireEvent.click(screen.getByText(/Show Options/));

      const maxLengthInput = screen.getByDisplayValue("10");
      fireEvent.change(maxLengthInput, { target: { value: "5" } });

      expect(props.onOptionsChange).toHaveBeenCalledWith({ maxLength: 5 });
    });
  });
});

describe("PathFindingButton", () => {
  it("should render button", () => {
    render(<PathFindingButton isActive={false} onClick={jest.fn()} />);

    expect(screen.getByTitle(/Find path between nodes/)).toBeInTheDocument();
  });

  it("should call onClick when clicked", () => {
    const onClick = jest.fn();

    render(<PathFindingButton isActive={false} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("should show active state", () => {
    const { container } = render(<PathFindingButton isActive={true} onClick={jest.fn()} />);

    expect(container.firstChild).toHaveClass("exo-pathfinding-button-active");
  });

  it("should show inactive title when not active", () => {
    render(<PathFindingButton isActive={false} onClick={jest.fn()} />);

    expect(screen.getByTitle("Find path between nodes")).toBeInTheDocument();
  });

  it("should show active title when active", () => {
    render(<PathFindingButton isActive={true} onClick={jest.fn()} />);

    expect(screen.getByTitle("Exit path finding mode")).toBeInTheDocument();
  });

  it("should apply custom className", () => {
    const { container } = render(
      <PathFindingButton isActive={false} onClick={jest.fn()} className="custom-class" />
    );

    expect(container.firstChild).toHaveClass("custom-class");
  });
});

/**
 * GraphNode Unit Tests
 *
 * Tests for the GraphNode component including:
 * - Basic rendering
 * - Position handling
 * - Selection and hover states
 * - Click handlers
 * - Label display
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, fireEvent } from "@testing-library/react";

import { GraphNode } from "@plugin/presentation/renderers/graph/GraphNode";
import type { GraphNode as GraphNodeData } from "@plugin/presentation/renderers/graph/types";

describe("GraphNode", () => {
  const createNode = (overrides: Partial<GraphNodeData> = {}): GraphNodeData => ({
    id: "node-1",
    label: "Test Node",
    path: "/path/to/asset.md",
    x: 100,
    y: 150,
    ...overrides,
  });

  const renderInSvg = (element: React.ReactElement) => {
    const { container, ...rest } = render(
      <svg>
        {element}
      </svg>
    );
    return { container, ...rest };
  };

  describe("Basic Rendering", () => {
    it("renders a group element with node data attributes", () => {
      const node = createNode();
      const { container } = renderInSvg(<GraphNode node={node} />);

      const group = container.querySelector("g.exo-graph-node");
      expect(group).toBeInTheDocument();
      expect(group).toHaveAttribute("data-node-id", "node-1");
      expect(group).toHaveAttribute("data-path", "/path/to/asset.md");
    });

    it("renders a circle element", () => {
      const node = createNode();
      const { container } = renderInSvg(<GraphNode node={node} />);

      const circle = container.querySelector("circle.exo-graph-node-circle");
      expect(circle).toBeInTheDocument();
    });

    it("applies transform based on node position", () => {
      const node = createNode({ x: 200, y: 300 });
      const { container } = renderInSvg(<GraphNode node={node} />);

      const group = container.querySelector("g.exo-graph-node");
      expect(group).toHaveAttribute("transform", "translate(200, 300)");
    });

    it("handles undefined position gracefully", () => {
      const node = createNode({ x: undefined, y: undefined });
      const { container } = renderInSvg(<GraphNode node={node} />);

      const group = container.querySelector("g.exo-graph-node");
      expect(group).toHaveAttribute("transform", "translate(0, 0)");
    });
  });

  describe("Labels", () => {
    it("renders label when showLabel is true", () => {
      const node = createNode({ label: "My Label" });
      const { container } = renderInSvg(<GraphNode node={node} showLabel={true} />);

      const label = container.querySelector("text.exo-graph-node-label");
      expect(label).toBeInTheDocument();
      expect(label).toHaveTextContent("My Label");
    });

    it("does not render label when showLabel is false", () => {
      const node = createNode({ label: "My Label" });
      const { container } = renderInSvg(<GraphNode node={node} showLabel={false} />);

      const label = container.querySelector("text.exo-graph-node-label");
      expect(label).not.toBeInTheDocument();
    });

    it("renders label by default", () => {
      const node = createNode({ label: "Default Label" });
      const { container } = renderInSvg(<GraphNode node={node} />);

      const label = container.querySelector("text.exo-graph-node-label");
      expect(label).toBeInTheDocument();
    });
  });

  describe("Interaction States", () => {
    it("applies selected class when isSelected is true", () => {
      const node = createNode();
      const { container } = renderInSvg(<GraphNode node={node} isSelected={true} />);

      const group = container.querySelector("g.exo-graph-node");
      expect(group).toHaveClass("exo-graph-node-selected");
    });

    it("applies hovered class when isHovered is true", () => {
      const node = createNode();
      const { container } = renderInSvg(<GraphNode node={node} isHovered={true} />);

      const group = container.querySelector("g.exo-graph-node");
      expect(group).toHaveClass("exo-graph-node-hovered");
    });

    it("applies draggable class when isDraggable is true", () => {
      const node = createNode();
      const { container } = renderInSvg(<GraphNode node={node} isDraggable={true} />);

      const group = container.querySelector("g.exo-graph-node");
      expect(group).toHaveClass("exo-graph-node-draggable");
    });

    it("renders selection ring when selected", () => {
      const node = createNode();
      const { container } = renderInSvg(<GraphNode node={node} isSelected={true} />);

      const ring = container.querySelector("circle.exo-graph-node-ring");
      expect(ring).toBeInTheDocument();
    });

    it("does not render selection ring when not selected", () => {
      const node = createNode();
      const { container } = renderInSvg(<GraphNode node={node} isSelected={false} />);

      const ring = container.querySelector("circle.exo-graph-node-ring");
      expect(ring).not.toBeInTheDocument();
    });
  });

  describe("Event Handlers", () => {
    it("calls onClick when clicked", () => {
      const onClick = jest.fn();
      const node = createNode();
      const { container } = renderInSvg(<GraphNode node={node} onClick={onClick} />);

      const group = container.querySelector("g.exo-graph-node");
      fireEvent.click(group!);

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("calls onMouseEnter when mouse enters", () => {
      const onMouseEnter = jest.fn();
      const node = createNode();
      const { container } = renderInSvg(<GraphNode node={node} onMouseEnter={onMouseEnter} />);

      const group = container.querySelector("g.exo-graph-node");
      fireEvent.mouseEnter(group!);

      expect(onMouseEnter).toHaveBeenCalledTimes(1);
    });

    it("calls onMouseLeave when mouse leaves", () => {
      const onMouseLeave = jest.fn();
      const node = createNode();
      const { container } = renderInSvg(<GraphNode node={node} onMouseLeave={onMouseLeave} />);

      const group = container.querySelector("g.exo-graph-node");
      fireEvent.mouseLeave(group!);

      expect(onMouseLeave).toHaveBeenCalledTimes(1);
    });
  });

  describe("Styling", () => {
    it("uses provided color for fill", () => {
      const node = createNode();
      const { container } = renderInSvg(<GraphNode node={node} color="#ff0000" />);

      const circle = container.querySelector("circle.exo-graph-node-circle");
      expect(circle).toHaveAttribute("fill", "#ff0000");
    });

    it("uses node color if provided", () => {
      const node = createNode({ color: "#00ff00" });
      const { container } = renderInSvg(<GraphNode node={node} color="#ff0000" />);

      // Node's own color takes precedence
      const circle = container.querySelector("circle.exo-graph-node-circle");
      expect(circle).toHaveAttribute("fill", "#00ff00");
    });

    it("applies custom radius", () => {
      const node = createNode();
      const { container } = renderInSvg(<GraphNode node={node} radius={15} />);

      const circle = container.querySelector("circle.exo-graph-node-circle");
      expect(circle).toHaveAttribute("r", "15");
    });

    it("scales radius based on node size property", () => {
      const node = createNode({ size: 2 });
      const { container } = renderInSvg(<GraphNode node={node} radius={10} />);

      const circle = container.querySelector("circle.exo-graph-node-circle");
      expect(circle).toHaveAttribute("r", "20"); // 10 * 2
    });
  });
});

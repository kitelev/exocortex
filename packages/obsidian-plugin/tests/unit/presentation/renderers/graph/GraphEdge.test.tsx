/**
 * GraphEdge Unit Tests
 *
 * Tests for the GraphEdge component including:
 * - Basic rendering
 * - Position handling
 * - Selection and hover states
 * - Click handlers
 * - Label display
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, fireEvent } from "@testing-library/react";

import { GraphEdge } from "@plugin/presentation/renderers/graph/GraphEdge";
import type { GraphEdge as GraphEdgeData } from "@plugin/presentation/renderers/graph/types";

describe("GraphEdge", () => {
  const createEdge = (overrides: Partial<GraphEdgeData> = {}): GraphEdgeData => ({
    id: "edge-1",
    source: "node-1",
    target: "node-2",
    label: "relates to",
    ...overrides,
  });

  const defaultPositions = {
    sourceX: 100,
    sourceY: 100,
    targetX: 200,
    targetY: 200,
  };

  const renderInSvg = (element: React.ReactElement) => {
    const { container, ...rest } = render(
      <svg>
        <defs>
          <marker id="arrowhead" />
        </defs>
        {element}
      </svg>
    );
    return { container, ...rest };
  };

  describe("Basic Rendering", () => {
    it("renders a group element with edge data attribute", () => {
      const edge = createEdge();
      const { container } = renderInSvg(
        <GraphEdge edge={edge} {...defaultPositions} />
      );

      const group = container.querySelector("g.exo-graph-edge");
      expect(group).toBeInTheDocument();
      expect(group).toHaveAttribute("data-edge-id", "edge-1");
    });

    it("renders a line element", () => {
      const edge = createEdge();
      const { container } = renderInSvg(
        <GraphEdge edge={edge} {...defaultPositions} />
      );

      const line = container.querySelector("line.exo-graph-edge-line");
      expect(line).toBeInTheDocument();
    });

    it("renders a hit area line for easier interaction", () => {
      const edge = createEdge();
      const { container } = renderInSvg(
        <GraphEdge edge={edge} {...defaultPositions} />
      );

      const hitarea = container.querySelector("line.exo-graph-edge-hitarea");
      expect(hitarea).toBeInTheDocument();
    });

    it("positions line from source to target", () => {
      const edge = createEdge();
      const { container } = renderInSvg(
        <GraphEdge
          edge={edge}
          sourceX={50}
          sourceY={75}
          targetX={150}
          targetY={175}
        />
      );

      const line = container.querySelector("line.exo-graph-edge-line");
      expect(line).toHaveAttribute("x1", "50");
      expect(line).toHaveAttribute("y1", "75");
      expect(line).toHaveAttribute("x2", "150");
      expect(line).toHaveAttribute("y2", "175");
    });
  });

  describe("Labels", () => {
    it("renders label when showLabel is true", () => {
      const edge = createEdge({ label: "blocked by" });
      const { container } = renderInSvg(
        <GraphEdge edge={edge} {...defaultPositions} showLabel={true} />
      );

      const label = container.querySelector("text.exo-graph-edge-label");
      expect(label).toBeInTheDocument();
      expect(label).toHaveTextContent("blocked by");
    });

    it("does not render label when showLabel is false", () => {
      const edge = createEdge({ label: "blocked by" });
      const { container } = renderInSvg(
        <GraphEdge edge={edge} {...defaultPositions} showLabel={false} />
      );

      const label = container.querySelector("text.exo-graph-edge-label");
      expect(label).not.toBeInTheDocument();
    });

    it("does not render label when edge has no label", () => {
      const edge = createEdge({ label: undefined });
      const { container } = renderInSvg(
        <GraphEdge edge={edge} {...defaultPositions} showLabel={true} />
      );

      const label = container.querySelector("text.exo-graph-edge-label");
      expect(label).not.toBeInTheDocument();
    });

    it("positions label at midpoint", () => {
      const edge = createEdge({ label: "test" });
      const { container } = renderInSvg(
        <GraphEdge
          edge={edge}
          sourceX={0}
          sourceY={0}
          targetX={200}
          targetY={100}
          showLabel={true}
        />
      );

      const label = container.querySelector("text.exo-graph-edge-label");
      expect(label).toHaveAttribute("x", "100"); // midpoint
      expect(label).toHaveAttribute("y", "45"); // midY - 5
    });
  });

  describe("Interaction States", () => {
    it("applies selected class when isSelected is true", () => {
      const edge = createEdge();
      const { container } = renderInSvg(
        <GraphEdge edge={edge} {...defaultPositions} isSelected={true} />
      );

      const group = container.querySelector("g.exo-graph-edge");
      expect(group).toHaveClass("exo-graph-edge-selected");
    });

    it("applies hovered class when isHovered is true", () => {
      const edge = createEdge();
      const { container } = renderInSvg(
        <GraphEdge edge={edge} {...defaultPositions} isHovered={true} />
      );

      const group = container.querySelector("g.exo-graph-edge");
      expect(group).toHaveClass("exo-graph-edge-hovered");
    });

    it("increases stroke opacity when hovered", () => {
      const edge = createEdge();
      const { container } = renderInSvg(
        <GraphEdge edge={edge} {...defaultPositions} isHovered={true} />
      );

      const line = container.querySelector("line.exo-graph-edge-line");
      expect(line).toHaveAttribute("stroke-opacity", "1");
    });

    it("uses accent color when selected", () => {
      const edge = createEdge();
      const { container } = renderInSvg(
        <GraphEdge edge={edge} {...defaultPositions} isSelected={true} />
      );

      const line = container.querySelector("line.exo-graph-edge-line");
      expect(line).toHaveAttribute("stroke", "var(--interactive-accent)");
    });
  });

  describe("Event Handlers", () => {
    it("calls onClick when clicked", () => {
      const onClick = jest.fn();
      const edge = createEdge();
      const { container } = renderInSvg(
        <GraphEdge edge={edge} {...defaultPositions} onClick={onClick} />
      );

      const group = container.querySelector("g.exo-graph-edge");
      fireEvent.click(group!);

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("calls onMouseEnter when mouse enters", () => {
      const onMouseEnter = jest.fn();
      const edge = createEdge();
      const { container } = renderInSvg(
        <GraphEdge edge={edge} {...defaultPositions} onMouseEnter={onMouseEnter} />
      );

      const group = container.querySelector("g.exo-graph-edge");
      fireEvent.mouseEnter(group!);

      expect(onMouseEnter).toHaveBeenCalledTimes(1);
    });

    it("calls onMouseLeave when mouse leaves", () => {
      const onMouseLeave = jest.fn();
      const edge = createEdge();
      const { container } = renderInSvg(
        <GraphEdge edge={edge} {...defaultPositions} onMouseLeave={onMouseLeave} />
      );

      const group = container.querySelector("g.exo-graph-edge");
      fireEvent.mouseLeave(group!);

      expect(onMouseLeave).toHaveBeenCalledTimes(1);
    });
  });

  describe("Styling", () => {
    it("uses provided color for stroke", () => {
      const edge = createEdge();
      const { container } = renderInSvg(
        <GraphEdge edge={edge} {...defaultPositions} color="#ff0000" />
      );

      const line = container.querySelector("line.exo-graph-edge-line");
      expect(line).toHaveAttribute("stroke", "#ff0000");
    });

    it("uses edge color if provided", () => {
      const edge = createEdge({ color: "#00ff00" });
      const { container } = renderInSvg(
        <GraphEdge edge={edge} {...defaultPositions} color="#ff0000" />
      );

      // Edge's own color takes precedence
      const line = container.querySelector("line.exo-graph-edge-line");
      expect(line).toHaveAttribute("stroke", "#00ff00");
    });

    it("adjusts stroke width based on edge weight", () => {
      const edge = createEdge({ weight: 3 });
      const { container } = renderInSvg(
        <GraphEdge edge={edge} {...defaultPositions} />
      );

      const line = container.querySelector("line.exo-graph-edge-line");
      // stroke width = 1 + weight = 4
      expect(line).toHaveAttribute("stroke-width", "4");
    });

    it("caps stroke width at maximum", () => {
      const edge = createEdge({ weight: 10 });
      const { container } = renderInSvg(
        <GraphEdge edge={edge} {...defaultPositions} />
      );

      const line = container.querySelector("line.exo-graph-edge-line");
      // stroke width capped at 5
      expect(line).toHaveAttribute("stroke-width", "5");
    });

    it("includes arrowhead marker reference", () => {
      const edge = createEdge();
      const { container } = renderInSvg(
        <GraphEdge edge={edge} {...defaultPositions} />
      );

      const line = container.querySelector("line.exo-graph-edge-line");
      expect(line).toHaveAttribute("marker-end", "url(#arrowhead)");
    });
  });
});

/**
 * GraphEdge Component
 *
 * Renders a single edge (link) between two nodes in the graph visualization.
 * Includes line, optional label, and interaction handlers.
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */
import React from "react";

import type { GraphEdgeProps } from "./types";

/**
 * GraphEdge - Renders a single graph edge
 *
 * @example
 * ```tsx
 * <GraphEdge
 *   edge={{ id: "e1", source: "n1", target: "n2", label: "relates to" }}
 *   sourceX={100}
 *   sourceY={100}
 *   targetX={200}
 *   targetY={200}
 *   showLabel={true}
 * />
 * ```
 */
export const GraphEdge: React.FC<GraphEdgeProps> = ({
  edge,
  sourceX,
  sourceY,
  targetX,
  targetY,
  isSelected = false,
  isHovered = false,
  color = "var(--text-muted)",
  showLabel = false,
  onClick,
  onMouseEnter,
  onMouseLeave,
}) => {
  // Calculate midpoint for label placement
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;

  // Calculate edge weight for stroke width
  const strokeWidth = edge.weight ? Math.min(1 + edge.weight, 5) : 1;
  const effectiveStrokeWidth = isHovered ? strokeWidth + 1 : strokeWidth;

  // Determine edge color
  const edgeColor = edge.color || color;

  return (
    <g
      className={`exo-graph-edge ${isSelected ? "exo-graph-edge-selected" : ""} ${isHovered ? "exo-graph-edge-hovered" : ""}`}
      data-edge-id={edge.id}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Edge line */}
      <line
        className="exo-graph-edge-line"
        x1={sourceX}
        y1={sourceY}
        x2={targetX}
        y2={targetY}
        stroke={isSelected ? "var(--interactive-accent)" : edgeColor}
        strokeWidth={effectiveStrokeWidth}
        strokeOpacity={isHovered || isSelected ? 1 : 0.6}
        markerEnd="url(#arrowhead)"
      />

      {/* Hover area for easier interaction */}
      <line
        className="exo-graph-edge-hitarea"
        x1={sourceX}
        y1={sourceY}
        x2={targetX}
        y2={targetY}
        stroke="transparent"
        strokeWidth={10}
        style={{ cursor: "pointer" }}
      />

      {/* Edge label */}
      {showLabel && edge.label && (
        <text
          className="exo-graph-edge-label"
          x={midX}
          y={midY - 5}
          textAnchor="middle"
          fill="var(--text-muted)"
          fontSize={10}
          pointerEvents="none"
        >
          {edge.label}
        </text>
      )}
    </g>
  );
};

export default GraphEdge;

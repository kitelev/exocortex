/**
 * GraphNode Component
 *
 * Renders a single node in the graph visualization.
 * Includes circle, label, and interaction handlers.
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */
import React from "react";

import type { GraphNodeProps } from "./types";

/**
 * GraphNode - Renders a single graph node
 *
 * @example
 * ```tsx
 * <GraphNode
 *   node={{ id: "1", label: "Task", path: "/path/to/task.md" }}
 *   radius={10}
 *   showLabel={true}
 *   onClick={(e) => handleClick(node.id, e)}
 * />
 * ```
 */
export const GraphNode: React.FC<GraphNodeProps> = ({
  node,
  radius = 8,
  isSelected = false,
  isHovered = false,
  isDraggable = true,
  color = "var(--interactive-accent)",
  showLabel = true,
  onClick,
  onMouseEnter,
  onMouseLeave,
}) => {
  const x = node.x ?? 0;
  const y = node.y ?? 0;

  // Calculate effective radius based on state and node size
  const sizeMultiplier = node.size ?? 1;
  const effectiveRadius = radius * sizeMultiplier;
  const hoverRadius = isHovered ? effectiveRadius * 1.2 : effectiveRadius;
  const selectedRadius = isSelected ? effectiveRadius * 1.3 : hoverRadius;

  // Determine fill color
  const fillColor = node.color || color;

  return (
    <g
      className={`exo-graph-node ${isSelected ? "exo-graph-node-selected" : ""} ${isHovered ? "exo-graph-node-hovered" : ""} ${isDraggable ? "exo-graph-node-draggable" : ""}`}
      transform={`translate(${x}, ${y})`}
      data-node-id={node.id}
      data-path={node.path}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ cursor: isDraggable ? "grab" : "pointer" }}
    >
      {/* Selection ring */}
      {isSelected && (
        <circle
          className="exo-graph-node-ring"
          r={selectedRadius + 4}
          fill="none"
          stroke="var(--interactive-accent)"
          strokeWidth={2}
          opacity={0.5}
        />
      )}

      {/* Main node circle */}
      <circle
        className="exo-graph-node-circle"
        r={selectedRadius}
        fill={fillColor}
        stroke={isHovered || isSelected ? "var(--text-normal)" : "var(--background-modifier-border)"}
        strokeWidth={isSelected ? 2 : 1}
      />

      {/* Node label */}
      {showLabel && (
        <text
          className="exo-graph-node-label"
          dy={selectedRadius + 14}
          textAnchor="middle"
          fill="var(--text-normal)"
          fontSize={12}
          pointerEvents="none"
        >
          {node.label}
        </text>
      )}
    </g>
  );
};

export default GraphNode;

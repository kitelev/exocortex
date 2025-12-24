/**
 * GraphLayoutRenderer Component
 *
 * Renders a GraphLayout definition as an interactive force-directed graph with:
 * - Force-directed layout using D3.js
 * - Barnes-Hut algorithm for O(n log n) many-body force calculation
 * - Nodes from assets with configurable labels
 * - Edges from specified properties
 * - Click on node opens asset
 * - Zoom and pan support
 * - CSS styles following Obsidian theme
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */
import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  zoom,
  zoomIdentity,
  select,
} from "d3";
import type { Simulation, SimulationNodeDatum, SimulationLinkDatum, ZoomBehavior } from "d3";

import type {
  GraphLayoutRendererProps,
  GraphLayoutOptions,
  GraphNode as GraphNodeType,
  GraphEdge as GraphEdgeType,
} from "./types";
import { GraphNode } from "./GraphNode";
import { GraphEdge } from "./GraphEdge";
import { BarnesHutForce } from "./BarnesHutForce";

/**
 * Threshold for using Barnes-Hut algorithm (nodes count)
 * For graphs with fewer nodes, naive O(n²) is fast enough
 */
const BARNES_HUT_THRESHOLD = 100;

/**
 * Default graph layout options
 */
const defaultOptions: GraphLayoutOptions = {
  width: "100%",
  height: 400,
  nodeRadius: 8,
  chargeStrength: -300,
  linkDistance: 100,
  zoomable: true,
  minZoom: 0.1,
  maxZoom: 4,
  draggable: true,
  showLabels: true,
  showEdgeLabels: false,
  nodeColor: "var(--interactive-accent)",
  edgeColor: "var(--text-muted)",
  // Barnes-Hut defaults
  useBarnesHut: undefined, // Auto-detect based on node count
  barnesHutTheta: 0.9,
  distanceMin: 1,
  distanceMax: Infinity,
};

/**
 * Internal node type with D3 simulation properties
 */
interface SimNode extends GraphNodeType, SimulationNodeDatum {
  x: number;
  y: number;
}

/**
 * Internal edge type with D3 simulation properties
 */
interface SimEdge extends SimulationLinkDatum<SimNode> {
  id: string;
  source: SimNode;
  target: SimNode;
  label?: string;
  property?: string;
  weight?: number;
  color?: string;
}

/**
 * GraphLayoutRenderer - Renders a GraphLayout as an interactive force-directed graph
 *
 * @example
 * ```tsx
 * <GraphLayoutRenderer
 *   layout={graphLayout}
 *   nodes={nodes}
 *   edges={edges}
 *   onNodeClick={(nodeId, path, event) => {
 *     // Navigate to asset
 *   }}
 * />
 * ```
 */
export const GraphLayoutRenderer: React.FC<GraphLayoutRendererProps> = ({
  layout,
  nodes,
  edges,
  onNodeClick,
  onEdgeClick,
  options: propOptions,
  className,
}) => {
  const options = { ...defaultOptions, ...propOptions };
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // State for simulation
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);
  const [simEdges, setSimEdges] = useState<SimEdge[]>([]);
  // simulationReady can be used for loading indicators in future
  const [, setSimulationReady] = useState(false);

  // State for interaction
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  // State for zoom transform
  const [transform, setTransform] = useState(
    options.initialZoom || { x: 0, y: 0, k: 1 }
  );

  // Refs for D3 simulation and zoom
  const simulationRef = useRef<Simulation<SimNode, SimEdge> | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // Calculate container dimensions
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const height =
          typeof options.height === "number"
            ? options.height
            : parseInt(String(options.height), 10) || 400;
        setDimensions({
          width: rect.width || 600,
          height,
        });
      }
    };

    updateDimensions();
    const observer = new ResizeObserver(updateDimensions);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [options.height]);

  // Initialize simulation when nodes/edges change
  useEffect(() => {
    if (nodes.length === 0) {
      setSimNodes([]);
      setSimEdges([]);
      setSimulationReady(true);
      return;
    }

    // Create node map for edge resolution
    const nodeMap = new Map<string, SimNode>();
    const initialNodes: SimNode[] = nodes.map((node, index) => {
      // Initialize positions in a circle if not set
      const angle = (2 * Math.PI * index) / nodes.length;
      const radius = Math.min(dimensions.width, dimensions.height) / 3;
      const simNode: SimNode = {
        ...node,
        x: node.x ?? dimensions.width / 2 + radius * Math.cos(angle),
        y: node.y ?? dimensions.height / 2 + radius * Math.sin(angle),
      };
      nodeMap.set(node.id, simNode);
      nodeMap.set(node.path, simNode);
      return simNode;
    });

    // Resolve edge source/target to SimNode references
    const initialEdges: SimEdge[] = [];
    for (const edge of edges) {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;
      const sourceNode = nodeMap.get(sourceId);
      const targetNode = nodeMap.get(targetId);

      if (sourceNode && targetNode) {
        initialEdges.push({
          id: edge.id,
          source: sourceNode,
          target: targetNode,
          label: edge.label,
          property: edge.property,
          weight: edge.weight,
          color: edge.color,
        });
      }
    }

    // Determine whether to use Barnes-Hut algorithm
    const useBarnesHut =
      options.useBarnesHut ?? initialNodes.length >= BARNES_HUT_THRESHOLD;

    // Create D3 force simulation
    const simulation = forceSimulation<SimNode>(initialNodes)
      .force(
        "link",
        forceLink<SimNode, SimEdge>(initialEdges)
          .id((d) => d.id)
          .distance(options.linkDistance!)
      )
      .force("center", forceCenter(dimensions.width / 2, dimensions.height / 2))
      .force(
        "collision",
        forceCollide().radius((options.nodeRadius ?? 8) * 2)
      );

    // Use Barnes-Hut for large graphs, or native forceManyBody for smaller ones
    if (useBarnesHut) {
      // Create Barnes-Hut force with custom tick handler
      const barnesHutForce = new BarnesHutForce({
        theta: options.barnesHutTheta ?? 0.9,
        strength: options.chargeStrength ?? -300,
        distanceMin: options.distanceMin ?? 1,
        distanceMax: options.distanceMax ?? Infinity,
      });
      barnesHutForce.initialize(initialNodes);

      // Add Barnes-Hut as a custom force
      simulation.force("charge", (alpha: number) => {
        barnesHutForce.force(alpha);
      });
    } else {
      // Use native D3 forceManyBody for smaller graphs
      const chargeForce = forceManyBody()
        .strength(options.chargeStrength!)
        .distanceMin(options.distanceMin ?? 1);

      if (
        options.distanceMax !== undefined &&
        options.distanceMax !== Infinity
      ) {
        chargeForce.distanceMax(options.distanceMax);
      }

      simulation.force("charge", chargeForce);
    }

    // Update state on each tick
    simulation.on("tick", () => {
      setSimNodes([...initialNodes]);
      setSimEdges([...initialEdges]);
    });

    // Mark simulation as ready after initial stabilization
    simulation.on("end", () => {
      setSimulationReady(true);
    });

    // Store reference for cleanup
    simulationRef.current = simulation;
    setSimNodes(initialNodes);
    setSimEdges(initialEdges);
    setSimulationReady(true);

    return () => {
      simulation.stop();
      simulationRef.current = null;
    };
  }, [nodes, edges, dimensions.width, dimensions.height, options.chargeStrength, options.linkDistance, options.nodeRadius, options.useBarnesHut, options.barnesHutTheta, options.distanceMin, options.distanceMax]);

  // Setup zoom behavior
  useEffect(() => {
    if (!svgRef.current || !options.zoomable) return;

    const svg = select(svgRef.current);

    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([options.minZoom!, options.maxZoom!])
      .on("zoom", (event) => {
        setTransform({
          x: event.transform.x,
          y: event.transform.y,
          k: event.transform.k,
        });
      });

    svg.call(zoomBehavior);
    zoomRef.current = zoomBehavior;

    // Apply initial transform
    if (options.initialZoom) {
      svg.call(
        zoomBehavior.transform,
        zoomIdentity
          .translate(options.initialZoom.x, options.initialZoom.y)
          .scale(options.initialZoom.k)
      );
    }

    return () => {
      svg.on(".zoom", null);
      zoomRef.current = null;
    };
  }, [options.zoomable, options.minZoom, options.maxZoom, options.initialZoom]);

  // Get node color
  const getNodeColor = useCallback(
    (node: GraphNodeType): string => {
      if (typeof options.nodeColor === "function") {
        return options.nodeColor(node);
      }
      return node.color || options.nodeColor || "var(--interactive-accent)";
    },
    [options.nodeColor]
  );

  // Get edge color
  const getEdgeColor = useCallback(
    (edge: GraphEdgeType): string => {
      if (typeof options.edgeColor === "function") {
        return options.edgeColor(edge);
      }
      return edge.color || options.edgeColor || "var(--text-muted)";
    },
    [options.edgeColor]
  );

  // Handle node click
  const handleNodeClick = useCallback(
    (node: SimNode, event: React.MouseEvent) => {
      event.stopPropagation();
      setSelectedNodeId(node.id);
      onNodeClick?.(node.id, node.path, event);
    },
    [onNodeClick]
  );

  // Handle edge click
  const handleEdgeClick = useCallback(
    (edge: SimEdge, event: React.MouseEvent) => {
      event.stopPropagation();
      onEdgeClick?.(edge.id, event);
    },
    [onEdgeClick]
  );

  // Handle background click to deselect
  const handleBackgroundClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // Calculate statistics
  const stats = useMemo(
    () => ({
      nodeCount: nodes.length,
      edgeCount: edges.length,
    }),
    [nodes.length, edges.length]
  );

  // Empty state
  if (nodes.length === 0) {
    return (
      <div className={`exo-graph-container exo-graph-empty ${className || ""}`}>
        <div className="exo-graph-header">
          <h3 className="exo-graph-title">{layout.label}</h3>
        </div>
        <div className="exo-graph-empty-message">
          No nodes to display. Add items that match the layout target class.
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`exo-graph-container ${className || ""}`}
      style={{
        width: options.width,
        height: typeof options.height === "number" ? `${options.height}px` : options.height,
      }}
    >
      <div className="exo-graph-header">
        <h3 className="exo-graph-title">{layout.label}</h3>
        <span className="exo-graph-stats">
          {stats.nodeCount} node{stats.nodeCount !== 1 ? "s" : ""}, {stats.edgeCount} edge{stats.edgeCount !== 1 ? "s" : ""}
        </span>
      </div>

      <svg
        ref={svgRef}
        className="exo-graph-svg"
        width={dimensions.width}
        height={dimensions.height - 40} // Account for header
        onClick={handleBackgroundClick}
      >
        {/* Defs for markers (arrowheads) */}
        <defs>
          <marker
            id="arrowhead"
            viewBox="0 -5 10 10"
            refX={20}
            refY={0}
            markerWidth={6}
            markerHeight={6}
            orient="auto"
          >
            <path d="M0,-5L10,0L0,5" fill="var(--text-muted)" />
          </marker>
        </defs>

        {/* Transformed group for zoom/pan */}
        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
          {/* Render edges first (underneath nodes) */}
          <g className="exo-graph-edges">
            {simEdges.map((edge) => (
              <GraphEdge
                key={edge.id}
                edge={edge}
                sourceX={edge.source.x ?? 0}
                sourceY={edge.source.y ?? 0}
                targetX={edge.target.x ?? 0}
                targetY={edge.target.y ?? 0}
                isHovered={hoveredEdgeId === edge.id}
                color={getEdgeColor(edge)}
                showLabel={options.showEdgeLabels}
                onClick={(e) => handleEdgeClick(edge, e)}
                onMouseEnter={() => setHoveredEdgeId(edge.id)}
                onMouseLeave={() => setHoveredEdgeId(null)}
              />
            ))}
          </g>

          {/* Render nodes on top */}
          <g className="exo-graph-nodes">
            {simNodes.map((node) => (
              <GraphNode
                key={node.id}
                node={node}
                radius={options.nodeRadius}
                isSelected={selectedNodeId === node.id}
                isHovered={hoveredNodeId === node.id}
                isDraggable={options.draggable}
                color={getNodeColor(node)}
                showLabel={options.showLabels}
                onClick={(e) => handleNodeClick(node, e)}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
              />
            ))}
          </g>
        </g>
      </svg>

      {/* Zoom controls */}
      {options.zoomable && (
        <div className="exo-graph-controls">
          <button
            className="exo-graph-control-btn"
            onClick={() => {
              if (svgRef.current && zoomRef.current) {
                const svg = select(svgRef.current);
                svg.transition().duration(300).call(zoomRef.current.scaleBy, 1.5);
              }
            }}
            title="Zoom in"
          >
            +
          </button>
          <button
            className="exo-graph-control-btn"
            onClick={() => {
              if (svgRef.current && zoomRef.current) {
                const svg = select(svgRef.current);
                svg.transition().duration(300).call(zoomRef.current.scaleBy, 0.67);
              }
            }}
            title="Zoom out"
          >
            -
          </button>
          <button
            className="exo-graph-control-btn"
            onClick={() => {
              if (svgRef.current && zoomRef.current) {
                const svg = select(svgRef.current);
                svg
                  .transition()
                  .duration(300)
                  .call(
                    zoomRef.current.transform,
                    zoomIdentity.translate(0, 0).scale(1)
                  );
              }
            }}
            title="Reset zoom"
          >
            ⟲
          </button>
        </div>
      )}
    </div>
  );
};

export default GraphLayoutRenderer;

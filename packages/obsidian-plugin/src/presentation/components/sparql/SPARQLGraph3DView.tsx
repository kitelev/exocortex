import React, { useEffect, useRef, useCallback } from "react";
import type { Triple } from "exocortex";
import type { GraphData } from "exocortex";
import { RDFToGraphDataConverter } from "@plugin/application/utils/RDFToGraphDataConverter";
import { Scene3DManager } from "@plugin/presentation/renderers/graph/3d/Scene3DManager";
import { ForceSimulation3D } from "@plugin/presentation/renderers/graph/3d/ForceSimulation3D";
import type { GraphNode3D, GraphEdge3D } from "@plugin/presentation/renderers/graph/3d/types3d";

interface SPARQLGraph3DViewProps {
  triples: Triple[];
  onAssetClick: (path: string) => void;
}

/**
 * Convert 2D graph data to 3D nodes and edges
 */
const convertTo3DData = (
  graphData: GraphData
): { nodes: GraphNode3D[]; edges: GraphEdge3D[] } => {
  const nodes: GraphNode3D[] = graphData.nodes.map((node) => ({
    id: node.path,
    label: node.label,
    path: node.path,
    metadata: node.properties,
  }));

  const edges: GraphEdge3D[] = graphData.edges.map((edge, index) => ({
    id: `edge-${index}`,
    source: edge.source,
    target: edge.target,
    label: edge.label,
  }));

  return { nodes, edges };
};

export const SPARQLGraph3DView: React.FC<SPARQLGraph3DViewProps> = ({
  triples,
  onAssetClick,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneManagerRef = useRef<Scene3DManager | null>(null);
  const simulationRef = useRef<ForceSimulation3D | null>(null);

  const handleNodeClick = useCallback(
    (path: string) => {
      onAssetClick(path);
    },
    [onAssetClick]
  );

  useEffect(() => {
    if (!containerRef.current || triples.length === 0) return;

    // Convert triples to graph data
    const graphData: GraphData = RDFToGraphDataConverter.convert(triples);
    const { nodes, edges } = convertTo3DData(graphData);

    if (nodes.length === 0) return;

    // Create and initialize scene manager
    const sceneManager = new Scene3DManager();
    sceneManager.initialize(containerRef.current);
    sceneManagerRef.current = sceneManager;

    // Create force simulation
    const simulation = new ForceSimulation3D(nodes, edges);
    simulationRef.current = simulation;

    // Set initial nodes and edges
    sceneManager.setNodes(nodes);
    sceneManager.setEdges(edges, nodes);

    // Handle simulation ticks
    simulation.on("tick", (event) => {
      const updatedNodes = event.nodes as GraphNode3D[];
      sceneManager.updatePositions(updatedNodes, edges);
    });

    // Handle node clicks
    sceneManager.on("nodeClick", (event) => {
      if (event.node) {
        handleNodeClick(event.node.path);
      }
    });

    // Start simulation
    simulation.start();

    // Fit view after a short delay for initial layout
    setTimeout(() => {
      sceneManager.fitToView(simulation.getNodes() as GraphNode3D[]);
    }, 100);

    // Cleanup
    return () => {
      simulation.destroy();
      sceneManager.destroy();
      sceneManagerRef.current = null;
      simulationRef.current = null;
    };
  }, [triples, handleNodeClick]);

  return (
    <div
      ref={containerRef}
      className="sparql-graph3d-view"
      style={{ width: "100%", height: "600px" }}
    />
  );
};

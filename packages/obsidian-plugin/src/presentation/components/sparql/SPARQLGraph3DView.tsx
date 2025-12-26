import React, { useEffect, useRef, useCallback, useMemo, useState } from "react";
import type { Triple } from "exocortex";
import type { GraphData } from "exocortex";
import { RDFToGraphDataConverter } from "@plugin/application/utils/RDFToGraphDataConverter";
import { Scene3DManager } from "@plugin/presentation/renderers/graph/3d/Scene3DManager";
import { ForceSimulation3D } from "@plugin/presentation/renderers/graph/3d/ForceSimulation3D";
import type { GraphNode3D, GraphEdge3D } from "@plugin/presentation/renderers/graph/3d/types3d";
import { Graph3DControlsToolbar, Graph3DControlState } from "./Graph3DControlsToolbar";

export interface SPARQLGraph3DViewProps {
  triples: Triple[];
  onAssetClick: (path: string) => void;
}

/**
 * Convert 2D graph data to 3D nodes and edges
 */
export const convertTo3DData = (
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

/**
 * SPARQLGraph3DView - Interactive 3D graph visualization for SPARQL query results
 *
 * Converts SPARQL triples to 3D nodes and edges, renders them using WebGL2,
 * and provides interactive camera controls (orbit, zoom, pan) and node click handling.
 *
 * Features:
 * - Force-directed 3D layout
 * - Camera reset with smooth animation
 * - Auto-rotate toggle
 * - Labels visibility toggle
 * - Fullscreen mode
 * - Keyboard shortcuts (R, A, L, F)
 *
 * @param triples - Array of RDF triples to visualize
 * @param onAssetClick - Callback when user clicks on a node (receives asset path)
 *
 * @example
 * ```tsx
 * <SPARQLGraph3DView
 *   triples={queryResults}
 *   onAssetClick={(path) => navigateToAsset(path)}
 * />
 * ```
 */
export const SPARQLGraph3DView: React.FC<SPARQLGraph3DViewProps> = ({
  triples,
  onAssetClick,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const sceneManagerRef = useRef<Scene3DManager | null>(null);
  const simulationRef = useRef<ForceSimulation3D | null>(null);

  // Control state
  const [controlState, setControlState] = useState<Graph3DControlState>({
    autoRotate: false,
    labelsVisible: true,
    isFullscreen: false,
  });

  // Memoize graph data conversion to avoid recalculation on every render
  const graphData = useMemo(() => {
    if (triples.length === 0) {
      return { nodes: [] as GraphNode3D[], edges: [] as GraphEdge3D[] };
    }
    const converted: GraphData = RDFToGraphDataConverter.convert(triples);
    return convertTo3DData(converted);
  }, [triples]);

  const hasNodes = graphData.nodes.length > 0;

  const handleNodeClick = useCallback(
    (path: string) => {
      onAssetClick(path);
    },
    [onAssetClick]
  );

  // Control handlers
  const handleCameraReset = useCallback(() => {
    if (sceneManagerRef.current) {
      sceneManagerRef.current.resetCamera(500);
    }
  }, []);

  const handleAutoRotateToggle = useCallback(() => {
    const newState = !controlState.autoRotate;
    setControlState((prev) => ({ ...prev, autoRotate: newState }));
    if (sceneManagerRef.current) {
      sceneManagerRef.current.setAutoRotate(newState, 0.5);
    }
  }, [controlState.autoRotate]);

  const handleLabelsToggle = useCallback(() => {
    const newState = !controlState.labelsVisible;
    setControlState((prev) => ({ ...prev, labelsVisible: newState }));
    if (sceneManagerRef.current) {
      sceneManagerRef.current.setLabelsVisible(newState);
    }
  }, [controlState.labelsVisible]);

  const handleFullscreenToggle = useCallback(() => {
    const newState = !controlState.isFullscreen;
    setControlState((prev) => ({ ...prev, isFullscreen: newState }));

    // Handle fullscreen API
    if (newState) {
      if (wrapperRef.current?.requestFullscreen) {
        wrapperRef.current.requestFullscreen().catch(() => {
          // Fallscreen fallback: use CSS fullscreen
          if (wrapperRef.current) {
            wrapperRef.current.classList.add("sparql-graph3d-view--fullscreen");
          }
        });
      } else if (wrapperRef.current) {
        // Fallback for browsers without fullscreen API
        wrapperRef.current.classList.add("sparql-graph3d-view--fullscreen");
      }
    } else {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {
          // Ignore errors
        });
      }
      if (wrapperRef.current) {
        wrapperRef.current.classList.remove("sparql-graph3d-view--fullscreen");
      }
    }
  }, [controlState.isFullscreen]);

  // Listen for fullscreen changes (e.g., user presses Escape)
  useEffect(() => {
    const handleFullscreenChange = (): void => {
      const isFullscreen = !!document.fullscreenElement;
      setControlState((prev) => {
        if (prev.isFullscreen !== isFullscreen) {
          // Also update CSS class
          if (!isFullscreen && wrapperRef.current) {
            wrapperRef.current.classList.remove("sparql-graph3d-view--fullscreen");
          }
          return { ...prev, isFullscreen };
        }
        return prev;
      });
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    // Don't initialize WebGL context if there are no nodes to display
    if (!containerRef.current || !hasNodes) return;

    const { nodes, edges } = graphData;

    // Create and initialize scene manager
    const sceneManager = new Scene3DManager();
    sceneManager.initialize(containerRef.current);
    sceneManagerRef.current = sceneManager;

    // Apply initial control state
    sceneManager.setLabelsVisible(controlState.labelsVisible);
    sceneManager.setAutoRotate(controlState.autoRotate, 0.5);

    // Create force simulation
    const simulation = new ForceSimulation3D(nodes, edges);
    simulationRef.current = simulation;

    // Set initial nodes and edges
    sceneManager.setNodes(nodes);
    sceneManager.setEdges(edges, nodes);

    // Handle simulation ticks - update positions in real-time
    simulation.on("tick", (event) => {
      const updatedNodes = event.nodes as GraphNode3D[];
      sceneManager.updatePositions(updatedNodes, edges);
    });

    // Handle simulation end - fit to view when forces stabilize
    simulation.on("end", (event) => {
      const finalNodes = event.nodes as GraphNode3D[];
      sceneManager.fitToView(finalNodes);
    });

    // Handle node clicks
    sceneManager.on("nodeClick", (event) => {
      if (event.node) {
        handleNodeClick(event.node.path);
      }
    });

    // Start simulation - nodes animate from random positions to force-directed layout
    simulation.start();

    // Cleanup - stops simulation and releases WebGL resources on unmount/ViewMode switch
    return () => {
      simulation.destroy();
      sceneManager.destroy();
      sceneManagerRef.current = null;
      simulationRef.current = null;
    };
    // Note: controlState intentionally excluded from deps to prevent re-initialization on every toggle
  }, [graphData, hasNodes, handleNodeClick]);

  // Display empty state message when there are no results to visualize
  if (!hasNodes) {
    return (
      <div
        className="sparql-graph3d-view sparql-graph3d-view-empty"
        style={{
          width: "100%",
          height: "600px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted)",
          fontSize: "14px",
        }}
        data-testid="sparql-graph3d-empty"
      >
        No results to visualize
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      className="sparql-graph3d-view-wrapper"
      style={{ position: "relative", width: "100%", height: "600px" }}
      data-testid="sparql-graph3d-wrapper"
    >
      <div
        ref={containerRef}
        className="sparql-graph3d-view"
        style={{ width: "100%", height: "100%" }}
        data-testid="sparql-graph3d-canvas"
      />
      <Graph3DControlsToolbar
        state={controlState}
        onCameraReset={handleCameraReset}
        onAutoRotateToggle={handleAutoRotateToggle}
        onLabelsToggle={handleLabelsToggle}
        onFullscreenToggle={handleFullscreenToggle}
      />
    </div>
  );
};

import React, { useEffect, useRef, useCallback, useMemo, useState } from "react";
import type { Triple } from "exocortex";
import type { GraphData, GraphEdge as GraphDataEdge } from "exocortex";
import { RDFToGraphDataConverter } from "@plugin/application/utils/RDFToGraphDataConverter";
import { Scene3DManager } from "@plugin/presentation/renderers/graph/3d/Scene3DManager";
import { ForceSimulation3D } from "@plugin/presentation/renderers/graph/3d/ForceSimulation3D";
import { Graph3DThemeService } from "@plugin/presentation/renderers/graph/3d/Graph3DThemeService";
import type { GraphNode3D, GraphEdge3D } from "@plugin/presentation/renderers/graph/3d/types3d";
import { Graph3DControlsToolbar, Graph3DControlState } from "./Graph3DControlsToolbar";

export interface SPARQLGraph3DViewProps {
  triples: Triple[];
  onAssetClick: (path: string) => void;
}

/**
 * Convert 2D graph data to 3D nodes and edges with theme-aware coloring
 *
 * @param graphData - 2D graph data from RDFToGraphDataConverter
 * @param themeService - Optional theme service for coloring
 * @returns 3D graph data with themed colors
 */
export const convertTo3DData = (
  graphData: GraphData,
  themeService?: Graph3DThemeService
): { nodes: GraphNode3D[]; edges: GraphEdge3D[] } => {
  const nodes: GraphNode3D[] = graphData.nodes.map((node) => {
    // Determine node color from type or path
    let color: string | undefined;
    if (themeService) {
      // Try to get type from properties first
      const nodeType = node.properties?.type as string | undefined;
      const uri = nodeType || node.path;
      color = themeService.getNodeColor(uri);
    }

    return {
      id: node.path,
      label: node.label,
      path: node.path,
      metadata: node.properties,
      color,
    };
  });

  const edges: GraphEdge3D[] = graphData.edges.map((edge: GraphDataEdge, index: number) => {
    // Get predicate for edge coloring
    const property = edge.label || "";
    let color: string | undefined;
    if (themeService) {
      color = themeService.getEdgeColor(property);
    }

    return {
      id: `edge-${index}`,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      property,
      color,
    };
  });

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
  const themeServiceRef = useRef<Graph3DThemeService | null>(null);

  // Control state
  const [controlState, setControlState] = useState<Graph3DControlState>({
    autoRotate: false,
    labelsVisible: true,
    isFullscreen: false,
  });

  // Create theme service lazily (only once)
  const getThemeService = useCallback((): Graph3DThemeService => {
    if (!themeServiceRef.current) {
      themeServiceRef.current = new Graph3DThemeService();
    }
    return themeServiceRef.current;
  }, []);

  // Memoize graph data conversion to avoid recalculation on every render
  const graphData = useMemo(() => {
    if (triples.length === 0) {
      return { nodes: [] as GraphNode3D[], edges: [] as GraphEdge3D[] };
    }
    const converted: GraphData = RDFToGraphDataConverter.convert(triples);
    const themeService = getThemeService();
    return convertTo3DData(converted, themeService);
  }, [triples, getThemeService]);

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

  // Cleanup theme service on unmount
  useEffect(() => {
    return () => {
      if (themeServiceRef.current) {
        themeServiceRef.current.destroy();
        themeServiceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    // Don't initialize WebGL context if there are no nodes to display
    if (!containerRef.current || !hasNodes) return;

    const { nodes, edges } = graphData;
    const themeService = getThemeService();
    const themeColors = themeService.getThemeColors();

    // Create scene config with theme-aware colors
    const sceneConfig = {
      backgroundColor: themeService.getBackgroundColorNumber(),
    };

    // Create label style with theme colors
    const labelStyle = {
      color: themeColors.labelColor,
      backgroundColor: themeColors.labelBackground,
    };

    // Create and initialize scene manager with theme config
    const sceneManager = new Scene3DManager(sceneConfig, {}, {}, labelStyle);
    sceneManager.initialize(containerRef.current);
    sceneManagerRef.current = sceneManager;

    // Apply initial control state
    sceneManager.setLabelsVisible(controlState.labelsVisible);
    sceneManager.setAutoRotate(controlState.autoRotate, 0.5);

    // Apply fog color to match background
    sceneManager.setFogColor(themeService.getFogColorNumber());

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

    // Listen for theme changes and update colors
    const handleThemeChange = (): void => {
      const newColors = themeService.getThemeColors();

      // Update background and fog
      sceneManager.setBackgroundColor(themeService.getBackgroundColorNumber());
      sceneManager.setFogColor(themeService.getFogColorNumber());

      // Update label style
      sceneManager.setLabelStyle(newColors.labelColor, newColors.labelBackground);

      // Update node colors based on new theme
      sceneManager.updateAllNodeColors((node) => {
        const nodeType = node.metadata?.type as string | undefined;
        const uri = nodeType || node.path;
        return themeService.getNodeColorNumber(uri);
      });

      // Update edge colors based on new theme
      sceneManager.updateAllEdgeColors((edge) => {
        const predicate = edge.property || edge.label || "";
        return themeService.getEdgeColorNumber(predicate);
      });
    };

    themeService.on("themeChange", handleThemeChange);

    // Start simulation - nodes animate from random positions to force-directed layout
    simulation.start();

    // Cleanup - stops simulation and releases WebGL resources on unmount/ViewMode switch
    return () => {
      themeService.off("themeChange", handleThemeChange);
      simulation.destroy();
      sceneManager.destroy();
      sceneManagerRef.current = null;
      simulationRef.current = null;
    };
    // Note: controlState intentionally excluded from deps to prevent re-initialization on every toggle
  }, [graphData, hasNodes, handleNodeClick, getThemeService]);

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

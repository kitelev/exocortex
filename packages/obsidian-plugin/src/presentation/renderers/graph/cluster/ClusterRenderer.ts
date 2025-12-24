/**
 * ClusterRenderer - Visualization renderer for node clustering
 *
 * Provides visual rendering for clustered graph data:
 * - Cluster boundaries with convex hull or bounding box
 * - Cluster labels and statistics
 * - Inter-cluster edge highlighting
 * - Cluster selection and interaction
 * - Animation support for cluster transitions
 *
 * @module presentation/renderers/graph/cluster
 * @since 1.0.0
 */

import type {
  ClusterNode,
  ClusterEdge,
  ClusterVisualizationData,
  ClusterVisualizationOptions,
  ClusterBoundary,
  ClusterSelectionState,
  ClusterEvent,
  ClusterEventType,
  ClusterEventListener,
} from "./ClusterTypes";
import { DEFAULT_CLUSTER_VISUALIZATION_OPTIONS } from "./ClusterTypes";
import type { CommunityDetectionResult } from "../CommunityDetection";
import { COMMUNITY_COLOR_PALETTES } from "../CommunityDetection";
import type { GraphData } from "../types";

// ============================================================
// Types
// ============================================================

/**
 * Configuration for ClusterRenderer
 */
export interface ClusterRendererConfig {
  /** Render target element */
  container?: HTMLElement;

  /** Width in pixels @default 800 */
  width?: number;

  /** Height in pixels @default 600 */
  height?: number;

  /** Visualization options */
  options?: ClusterVisualizationOptions;
}

/**
 * Default renderer configuration
 */
const DEFAULT_RENDERER_CONFIG: Required<Omit<ClusterRendererConfig, "container">> = {
  width: 800,
  height: 600,
  options: DEFAULT_CLUSTER_VISUALIZATION_OPTIONS,
};

/**
 * Render context for drawing operations
 */
interface RenderContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

// ============================================================
// ClusterRenderer Implementation
// ============================================================

/**
 * ClusterRenderer - Visual renderer for clustered graph data
 *
 * Features:
 * - Cluster boundary visualization (convex hull or bounding box)
 * - Cluster coloring with configurable palettes
 * - Inter-cluster edge distinction
 * - Cluster labels and statistics display
 * - Selection and hover states
 * - Smooth animation transitions
 *
 * @example
 * ```typescript
 * const renderer = new ClusterRenderer({ container: document.getElementById("graph") });
 *
 * // Set data
 * renderer.setData(clusterVisualizationData);
 *
 * // Listen to events
 * renderer.on("cluster-click", (event) => {
 *   console.log("Clicked cluster:", event.clusterId);
 * });
 *
 * // Render
 * renderer.render();
 * ```
 */
export class ClusterRenderer {
  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private config: Required<Omit<ClusterRendererConfig, "container">> & { container?: HTMLElement };
  private options: Required<ClusterVisualizationOptions>;

  private data: ClusterVisualizationData | null = null;
  private boundaries: ClusterBoundary[] = [];

  private selectionState: ClusterSelectionState = {
    selectedClusters: new Set(),
    expandedClusters: new Set(),
    collapsedClusters: new Set(),
  };

  private listeners: Map<ClusterEventType, Set<ClusterEventListener>> = new Map();

  // Animation state
  private animationFrame: number | null = null;
  private animationProgress = 1;
  private previousPositions: Map<string, { x: number; y: number }> = new Map();

  constructor(config: ClusterRendererConfig = {}) {
    this.config = { ...DEFAULT_RENDERER_CONFIG, ...config };
    this.options = { ...DEFAULT_CLUSTER_VISUALIZATION_OPTIONS, ...config.options };

    if (config.container) {
      this.container = config.container;
      this.initializeCanvas();
    }
  }

  /**
   * Initialize or attach to a container element
   */
  attach(container: HTMLElement): void {
    this.container = container;
    this.initializeCanvas();
  }

  /**
   * Set the cluster visualization data
   */
  setData(data: ClusterVisualizationData): void {
    // Store previous positions for animation
    if (this.data && this.options.animateTransitions) {
      this.previousPositions.clear();
      for (const node of this.data.nodes) {
        if (node.x !== undefined && node.y !== undefined) {
          this.previousPositions.set(node.id, { x: node.x, y: node.y });
        }
      }
      this.animationProgress = 0;
    }

    this.data = data;
    this.calculateBoundaries();

    if (this.options.animateTransitions && this.previousPositions.size > 0) {
      this.startAnimation();
    } else {
      this.render();
    }
  }

  /**
   * Build cluster visualization data from graph and community detection result
   */
  static buildVisualizationData(
    graph: GraphData,
    result: CommunityDetectionResult
  ): ClusterVisualizationData {
    const colorPalette = COMMUNITY_COLOR_PALETTES.categorical;

    // Build cluster nodes
    const nodes: ClusterNode[] = graph.nodes.map((node) => {
      const assignment = result.assignments.get(node.id);
      return {
        ...node,
        clusterId: assignment?.communityId,
        clusterConfidence: assignment?.confidence,
        clusterColor: assignment
          ? colorPalette[assignment.communityId % colorPalette.length]
          : undefined,
      };
    });

    // Build cluster edges
    const edges: ClusterEdge[] = graph.edges.map((edge) => {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

      const sourceAssignment = result.assignments.get(sourceId);
      const targetAssignment = result.assignments.get(targetId);

      return {
        ...edge,
        sourceClusterId: sourceAssignment?.communityId,
        targetClusterId: targetAssignment?.communityId,
        isIntraCluster:
          sourceAssignment?.communityId !== undefined &&
          sourceAssignment.communityId === targetAssignment?.communityId,
      };
    });

    return {
      nodes,
      edges,
      communities: result.communities,
      modularity: result.modularity,
    };
  }

  /**
   * Update visualization options
   */
  setOptions(options: Partial<ClusterVisualizationOptions>): void {
    this.options = { ...this.options, ...options };
    this.calculateBoundaries();
    this.render();
  }

  /**
   * Get current visualization options
   */
  getOptions(): ClusterVisualizationOptions {
    return { ...this.options };
  }

  /**
   * Select a cluster
   */
  selectCluster(clusterId: number, additive = false): void {
    if (!additive) {
      this.selectionState.selectedClusters.clear();
    }
    this.selectionState.selectedClusters.add(clusterId);
    this.render();
    this.emit({
      type: "cluster-select",
      clusterId,
      cluster: this.data?.communities.find((c) => c.id === clusterId),
    });
  }

  /**
   * Deselect a cluster
   */
  deselectCluster(clusterId: number): void {
    this.selectionState.selectedClusters.delete(clusterId);
    this.render();
  }

  /**
   * Clear all cluster selections
   */
  clearSelection(): void {
    this.selectionState.selectedClusters.clear();
    this.selectionState.highlightedCluster = undefined;
    this.render();
  }

  /**
   * Expand a cluster to show internal structure
   */
  expandCluster(clusterId: number): void {
    this.selectionState.expandedClusters.add(clusterId);
    this.selectionState.collapsedClusters.delete(clusterId);
    this.render();
    this.emit({
      type: "cluster-expand",
      clusterId,
      cluster: this.data?.communities.find((c) => c.id === clusterId),
    });
  }

  /**
   * Collapse a cluster to single node representation
   */
  collapseCluster(clusterId: number): void {
    this.selectionState.collapsedClusters.add(clusterId);
    this.selectionState.expandedClusters.delete(clusterId);
    this.render();
    this.emit({
      type: "cluster-collapse",
      clusterId,
      cluster: this.data?.communities.find((c) => c.id === clusterId),
    });
  }

  /**
   * Get selection state
   */
  getSelectionState(): ClusterSelectionState {
    return {
      selectedClusters: new Set(this.selectionState.selectedClusters),
      highlightedCluster: this.selectionState.highlightedCluster,
      expandedClusters: new Set(this.selectionState.expandedClusters),
      collapsedClusters: new Set(this.selectionState.collapsedClusters),
    };
  }

  /**
   * Get cluster boundaries for external rendering
   */
  getBoundaries(): ClusterBoundary[] {
    return [...this.boundaries];
  }

  /**
   * Add event listener
   */
  on(type: ClusterEventType, listener: ClusterEventListener): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  /**
   * Remove event listener
   */
  off(type: ClusterEventType, listener: ClusterEventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  /**
   * Render the cluster visualization
   */
  render(): void {
    if (!this.ctx || !this.data) return;

    const ctx = this.ctx;
    const width = this.config.width;
    const height = this.config.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Create render context
    const renderCtx: RenderContext = {
      ctx,
      width,
      height,
      scale: 1,
      offsetX: width / 2,
      offsetY: height / 2,
    };

    // Render in order: boundaries -> edges -> nodes -> labels
    if (this.options.showClusterBoundaries) {
      this.renderBoundaries(renderCtx);
    }

    this.renderEdges(renderCtx);
    this.renderNodes(renderCtx);

    if (this.options.showClusterLabels) {
      this.renderClusterLabels(renderCtx);
    }
  }

  /**
   * Dispose of renderer resources
   */
  dispose(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    this.listeners.clear();
    this.data = null;
    this.boundaries = [];

    if (this.canvas && this.container) {
      this.container.removeChild(this.canvas);
    }
    this.canvas = null;
    this.ctx = null;
    this.container = null;
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private initializeCanvas(): void {
    if (!this.container) return;

    // Create canvas if not exists
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.config.width;
    this.canvas.height = this.config.height;
    this.canvas.classList.add("cluster-canvas");
    // Use standard style assignment for canvas sizing
    // eslint-disable-next-line obsidianmd/no-static-styles-assignment
    this.canvas.style.width = "100%";
    // eslint-disable-next-line obsidianmd/no-static-styles-assignment
    this.canvas.style.height = "100%";

    // Get 2D context
    this.ctx = this.canvas.getContext("2d");

    // Add event listeners
    this.canvas.addEventListener("click", this.handleClick.bind(this));
    this.canvas.addEventListener("mousemove", this.handleMouseMove.bind(this));
    this.canvas.addEventListener("mouseleave", this.handleMouseLeave.bind(this));

    // Append to container
    this.container.appendChild(this.canvas);
  }

  private calculateBoundaries(): void {
    if (!this.data) {
      this.boundaries = [];
      return;
    }

    const colorPalette = COMMUNITY_COLOR_PALETTES[this.options.colorPalette];
    this.boundaries = [];

    for (const community of this.data.communities) {
      const clusterNodes = this.data.nodes.filter(
        (n) => n.clusterId === community.id
      );

      if (clusterNodes.length === 0) continue;

      // Calculate bounding box
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const node of clusterNodes) {
        const x = node.x ?? 0;
        const y = node.y ?? 0;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }

      // Add padding
      const padding = 30;
      minX -= padding;
      minY -= padding;
      maxX += padding;
      maxY += padding;

      // Calculate center
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      // Calculate convex hull
      const hull = this.calculateConvexHull(
        clusterNodes.map((n) => ({ x: n.x ?? 0, y: n.y ?? 0 }))
      );

      const boundary: ClusterBoundary = {
        clusterId: community.id,
        color: colorPalette[community.id % colorPalette.length],
        bounds: {
          minX,
          minY,
          maxX,
          maxY,
          width: maxX - minX,
          height: maxY - minY,
        },
        hull: hull.length >= 3 ? hull : undefined,
        center: { x: centerX, y: centerY },
        label: community.label || `Cluster ${community.id + 1}`,
      };

      this.boundaries.push(boundary);
    }
  }

  private calculateConvexHull(
    points: Array<{ x: number; y: number }>
  ): Array<{ x: number; y: number }> {
    if (points.length < 3) return points;

    // Graham scan algorithm
    const sortedPoints = [...points].sort((a, b) =>
      a.x === b.x ? a.y - b.y : a.x - b.x
    );

    const cross = (
      o: { x: number; y: number },
      a: { x: number; y: number },
      b: { x: number; y: number }
    ) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

    // Build lower hull
    const lower: Array<{ x: number; y: number }> = [];
    for (const p of sortedPoints) {
      while (
        lower.length >= 2 &&
        cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
      ) {
        lower.pop();
      }
      lower.push(p);
    }

    // Build upper hull
    const upper: Array<{ x: number; y: number }> = [];
    for (let i = sortedPoints.length - 1; i >= 0; i--) {
      const p = sortedPoints[i];
      while (
        upper.length >= 2 &&
        cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
      ) {
        upper.pop();
      }
      upper.push(p);
    }

    // Remove last point of each half (it's the first point of the other half)
    lower.pop();
    upper.pop();

    return [...lower, ...upper];
  }

  private renderBoundaries(ctx: RenderContext): void {
    for (const boundary of this.boundaries) {
      const isSelected = this.selectionState.selectedClusters.has(boundary.clusterId);
      const isHighlighted = this.selectionState.highlightedCluster === boundary.clusterId;

      ctx.ctx.save();

      // Set fill style with opacity
      ctx.ctx.globalAlpha =
        this.options.boundaryOpacity * (isSelected ? 2 : isHighlighted ? 1.5 : 1);
      ctx.ctx.fillStyle = boundary.color;

      // Draw boundary shape
      if (boundary.hull && boundary.hull.length >= 3) {
        // Draw convex hull with padding
        ctx.ctx.beginPath();
        const padding = 20;

        // Expand hull points outward from center
        const expandedHull = boundary.hull.map((p) => {
          const dx = p.x - boundary.center.x;
          const dy = p.y - boundary.center.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist === 0) return p;
          const factor = (dist + padding) / dist;
          return {
            x: boundary.center.x + dx * factor + ctx.offsetX,
            y: boundary.center.y + dy * factor + ctx.offsetY,
          };
        });

        ctx.ctx.moveTo(expandedHull[0].x, expandedHull[0].y);
        for (let i = 1; i < expandedHull.length; i++) {
          ctx.ctx.lineTo(expandedHull[i].x, expandedHull[i].y);
        }
        ctx.ctx.closePath();
      } else {
        // Draw rounded rectangle
        const x = boundary.bounds.minX + ctx.offsetX;
        const y = boundary.bounds.minY + ctx.offsetY;
        const w = boundary.bounds.width;
        const h = boundary.bounds.height;
        const r = 10;

        ctx.ctx.beginPath();
        ctx.ctx.moveTo(x + r, y);
        ctx.ctx.lineTo(x + w - r, y);
        ctx.ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.ctx.lineTo(x + w, y + h - r);
        ctx.ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.ctx.lineTo(x + r, y + h);
        ctx.ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.ctx.lineTo(x, y + r);
        ctx.ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.ctx.closePath();
      }

      ctx.ctx.fill();

      // Draw border if selected
      if (isSelected || isHighlighted) {
        ctx.ctx.globalAlpha = 0.8;
        ctx.ctx.strokeStyle = boundary.color;
        ctx.ctx.lineWidth = isSelected ? 3 : 2;
        ctx.ctx.stroke();
      }

      ctx.ctx.restore();
    }
  }

  private renderEdges(ctx: RenderContext): void {
    if (!this.data) return;

    for (const edge of this.data.edges) {
      const sourceNode = this.data.nodes.find((n) =>
        typeof edge.source === "string" ? n.id === edge.source : n.id === edge.source.id
      );
      const targetNode = this.data.nodes.find((n) =>
        typeof edge.target === "string" ? n.id === edge.target : n.id === edge.target.id
      );

      if (!sourceNode || !targetNode) continue;

      const sourceX = (sourceNode.x ?? 0) + ctx.offsetX;
      const sourceY = (sourceNode.y ?? 0) + ctx.offsetY;
      const targetX = (targetNode.x ?? 0) + ctx.offsetX;
      const targetY = (targetNode.y ?? 0) + ctx.offsetY;

      // Interpolate position for animation
      let finalSourceX = sourceX;
      let finalSourceY = sourceY;
      let finalTargetX = targetX;
      let finalTargetY = targetY;

      if (this.animationProgress < 1) {
        const prevSource = this.previousPositions.get(sourceNode.id);
        const prevTarget = this.previousPositions.get(targetNode.id);

        if (prevSource) {
          finalSourceX = this.lerp(
            prevSource.x + ctx.offsetX,
            sourceX,
            this.easeOutCubic(this.animationProgress)
          );
          finalSourceY = this.lerp(
            prevSource.y + ctx.offsetY,
            sourceY,
            this.easeOutCubic(this.animationProgress)
          );
        }
        if (prevTarget) {
          finalTargetX = this.lerp(
            prevTarget.x + ctx.offsetX,
            targetX,
            this.easeOutCubic(this.animationProgress)
          );
          finalTargetY = this.lerp(
            prevTarget.y + ctx.offsetY,
            targetY,
            this.easeOutCubic(this.animationProgress)
          );
        }
      }

      ctx.ctx.save();
      ctx.ctx.beginPath();
      ctx.ctx.moveTo(finalSourceX, finalSourceY);
      ctx.ctx.lineTo(finalTargetX, finalTargetY);

      // Style based on intra/inter cluster
      if (edge.isIntraCluster) {
        ctx.ctx.strokeStyle = edge.color || "#64748b";
        ctx.ctx.lineWidth = 1;
        ctx.ctx.globalAlpha = 0.6;
      } else {
        ctx.ctx.strokeStyle = this.options.highlightInterClusterEdges
          ? this.options.interClusterEdgeColor
          : edge.color || "#64748b";
        ctx.ctx.lineWidth = this.options.highlightInterClusterEdges ? 2 : 1;
        ctx.ctx.globalAlpha = this.options.highlightInterClusterEdges ? 0.8 : 0.3;
        ctx.ctx.setLineDash([5, 5]);
      }

      ctx.ctx.stroke();
      ctx.ctx.restore();
    }
  }

  private renderNodes(ctx: RenderContext): void {
    if (!this.data) return;

    for (const node of this.data.nodes) {
      const x = (node.x ?? 0) + ctx.offsetX;
      const y = (node.y ?? 0) + ctx.offsetY;

      // Interpolate position for animation
      let finalX = x;
      let finalY = y;

      if (this.animationProgress < 1) {
        const prevPos = this.previousPositions.get(node.id);
        if (prevPos) {
          finalX = this.lerp(
            prevPos.x + ctx.offsetX,
            x,
            this.easeOutCubic(this.animationProgress)
          );
          finalY = this.lerp(
            prevPos.y + ctx.offsetY,
            y,
            this.easeOutCubic(this.animationProgress)
          );
        }
      }

      const radius = (node.size ?? 1) * 8;
      const color = node.clusterColor || node.color || "#6366f1";

      ctx.ctx.save();

      // Draw node circle
      ctx.ctx.beginPath();
      ctx.ctx.arc(finalX, finalY, radius, 0, Math.PI * 2);
      ctx.ctx.fillStyle = color;
      ctx.ctx.fill();

      // Draw border
      ctx.ctx.strokeStyle = "#ffffff";
      ctx.ctx.lineWidth = 2;
      ctx.ctx.stroke();

      // Draw hub indicator
      if (node.isClusterHub) {
        ctx.ctx.beginPath();
        ctx.ctx.arc(finalX, finalY, radius + 4, 0, Math.PI * 2);
        ctx.ctx.strokeStyle = color;
        ctx.ctx.lineWidth = 2;
        ctx.ctx.setLineDash([4, 2]);
        ctx.ctx.stroke();
      }

      ctx.ctx.restore();
    }
  }

  private renderClusterLabels(ctx: RenderContext): void {
    for (const boundary of this.boundaries) {
      const community = this.data?.communities.find((c) => c.id === boundary.clusterId);
      if (!community || community.size < this.options.minClusterSizeForLabel) continue;

      const labelText = boundary.label || `Cluster ${boundary.clusterId + 1}`;
      const x = boundary.center.x + ctx.offsetX;
      const y = boundary.bounds.minY + ctx.offsetY - 10;

      ctx.ctx.save();
      ctx.ctx.font = `bold ${this.options.clusterLabelFontSize}px Inter, sans-serif`;
      ctx.ctx.textAlign = "center";
      ctx.ctx.textBaseline = "bottom";

      // Draw background
      const textWidth = ctx.ctx.measureText(labelText).width;
      ctx.ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.ctx.fillRect(
        x - textWidth / 2 - 4,
        y - this.options.clusterLabelFontSize - 2,
        textWidth + 8,
        this.options.clusterLabelFontSize + 4
      );

      // Draw text
      ctx.ctx.fillStyle = "#ffffff";
      ctx.ctx.fillText(labelText, x, y);

      // Show stats if enabled
      if (this.options.showClusterStats) {
        const statsText = `(${community.size} nodes)`;
        ctx.ctx.font = `${this.options.clusterLabelFontSize - 2}px Inter, sans-serif`;
        ctx.ctx.fillStyle = "#aaaaaa";
        ctx.ctx.fillText(statsText, x, y + this.options.clusterLabelFontSize);
      }

      ctx.ctx.restore();
    }
  }

  private handleClick(event: MouseEvent): void {
    const point = this.getCanvasPoint(event);
    const clusterId = this.findClusterAtPoint(point);

    if (clusterId !== undefined) {
      this.emit({
        type: "cluster-click",
        clusterId,
        cluster: this.data?.communities.find((c) => c.id === clusterId),
        mouseEvent: event,
      });
    }
  }

  private handleMouseMove(event: MouseEvent): void {
    const point = this.getCanvasPoint(event);
    const clusterId = this.findClusterAtPoint(point);

    if (clusterId !== this.selectionState.highlightedCluster) {
      this.selectionState.highlightedCluster = clusterId;
      this.render();

      if (clusterId !== undefined) {
        this.emit({
          type: "cluster-hover",
          clusterId,
          cluster: this.data?.communities.find((c) => c.id === clusterId),
          mouseEvent: event,
        });
      }
    }
  }

  private handleMouseLeave(): void {
    if (this.selectionState.highlightedCluster !== undefined) {
      this.selectionState.highlightedCluster = undefined;
      this.render();
    }
  }

  private getCanvasPoint(event: MouseEvent): { x: number; y: number } {
    if (!this.canvas) return { x: 0, y: 0 };

    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;

    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  private findClusterAtPoint(point: { x: number; y: number }): number | undefined {
    const offsetX = this.config.width / 2;
    const offsetY = this.config.height / 2;

    for (const boundary of this.boundaries) {
      const x = point.x - offsetX;
      const y = point.y - offsetY;

      // Check bounding box first
      if (
        x >= boundary.bounds.minX &&
        x <= boundary.bounds.maxX &&
        y >= boundary.bounds.minY &&
        y <= boundary.bounds.maxY
      ) {
        return boundary.clusterId;
      }
    }

    return undefined;
  }

  private startAnimation(): void {
    const duration = this.options.transitionDuration;
    const startTime = performance.now();

    const animate = () => {
      const elapsed = performance.now() - startTime;
      this.animationProgress = Math.min(1, elapsed / duration);

      this.render();

      if (this.animationProgress < 1) {
        this.animationFrame = requestAnimationFrame(animate);
      } else {
        this.animationFrame = null;
        this.previousPositions.clear();
      }
    };

    this.animationFrame = requestAnimationFrame(animate);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  private easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  private emit(event: ClusterEvent): void {
    const listeners = this.listeners.get(event.type);
    if (listeners) {
      for (const listener of listeners) {
        listener(event);
      }
    }
  }
}

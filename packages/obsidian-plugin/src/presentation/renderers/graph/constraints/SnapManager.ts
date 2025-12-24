/**
 * SnapManager - Alignment guide and snap-to-grid functionality
 *
 * Provides visual alignment guides and snap-to-position functionality
 * when dragging nodes. Supports snapping to other nodes, grid lines,
 * and custom alignment positions.
 *
 * @module presentation/renderers/graph/constraints
 * @since 1.0.0
 */

import type { Point, SnapResult, AlignmentGuide } from "./constraint.types";

// ============================================================
// Configuration
// ============================================================

/**
 * Configuration for snap behavior
 */
export interface SnapConfig {
  /** Whether snapping is enabled */
  enabled: boolean;

  /** Snap threshold in pixels (distance at which snapping activates) */
  snapThreshold: number;

  /** Whether to snap to other nodes */
  snapToNodes: boolean;

  /** Whether to snap to grid */
  snapToGrid: boolean;

  /** Grid size in pixels (used when snapToGrid is true) */
  gridSize: number;

  /** Whether to show alignment guides */
  showGuides: boolean;

  /** Guide line color */
  guideColor: string;

  /** Guide line opacity */
  guideOpacity: number;

  /** Guide line width */
  guideWidth: number;

  /** Guide line style */
  guideStyle: "solid" | "dashed" | "dotted";

  /** Custom snap positions (fixed points to snap to) */
  customSnapPositions: Point[];
}

/**
 * Default snap configuration
 */
export const DEFAULT_SNAP_CONFIG: SnapConfig = {
  enabled: true,
  snapThreshold: 10,
  snapToNodes: true,
  snapToGrid: false,
  gridSize: 20,
  showGuides: true,
  guideColor: "#3b82f6",
  guideOpacity: 0.5,
  guideWidth: 1,
  guideStyle: "dashed",
  customSnapPositions: [],
};

// ============================================================
// SnapManager Class
// ============================================================

/**
 * Alignment guide and snap-to-position manager
 *
 * Manages snapping behavior during node dragging and provides
 * visual alignment guides for precise positioning.
 *
 * @example
 * ```typescript
 * const snapManager = new SnapManager({ snapThreshold: 15 });
 *
 * // Get other node positions
 * const otherNodes = new Map([
 *   ['node1', { x: 100, y: 100 }],
 *   ['node2', { x: 200, y: 100 }],
 * ]);
 *
 * // Get snap result while dragging
 * const result = snapManager.getSnapResult(
 *   'draggingNode',
 *   { x: 105, y: 150 },
 *   otherNodes
 * );
 *
 * // Apply snapped position
 * if (result.snapped) {
 *   node.position = result.position;
 * }
 *
 * // Render guides
 * const guides = snapManager.getActiveGuides();
 * ```
 */
export class SnapManager {
  private config: SnapConfig;
  private activeGuides: AlignmentGuide[] = [];

  constructor(config: Partial<SnapConfig> = {}) {
    this.config = {
      ...DEFAULT_SNAP_CONFIG,
      ...config,
      // Deep copy customSnapPositions to avoid shared state between instances
      customSnapPositions: config.customSnapPositions
        ? [...config.customSnapPositions]
        : [...DEFAULT_SNAP_CONFIG.customSnapPositions],
    };
  }

  /**
   * Get snap result for a node at a position
   */
  getSnapResult(
    nodeId: string,
    position: Point,
    otherNodePositions: Map<string, Point>
  ): SnapResult {
    if (!this.config.enabled) {
      return { position, snapped: false };
    }

    this.activeGuides = [];

    let snappedX = position.x;
    let snappedY = position.y;
    let horizontalTarget: Point | undefined;
    let verticalTarget: Point | undefined;

    // Snap to other nodes
    if (this.config.snapToNodes) {
      const nodeSnap = this.findNodeSnapPoints(position, otherNodePositions);

      if (nodeSnap.horizontalSnap) {
        snappedY = nodeSnap.horizontalSnap.y;
        horizontalTarget = nodeSnap.horizontalSnap;
      }

      if (nodeSnap.verticalSnap) {
        snappedX = nodeSnap.verticalSnap.x;
        verticalTarget = nodeSnap.verticalSnap;
      }
    }

    // Snap to grid
    if (this.config.snapToGrid) {
      const gridSnap = this.findGridSnapPoint({ x: snappedX, y: snappedY });
      snappedX = gridSnap.x;
      snappedY = gridSnap.y;
    }

    // Snap to custom positions
    if (this.config.customSnapPositions.length > 0) {
      const customSnap = this.findCustomSnapPoint({ x: snappedX, y: snappedY });
      if (customSnap) {
        snappedX = customSnap.x;
        snappedY = customSnap.y;
      }
    }

    const snapped =
      Math.abs(snappedX - position.x) > 0.01 ||
      Math.abs(snappedY - position.y) > 0.01;

    // Create guides for snap targets
    if (this.config.showGuides) {
      if (horizontalTarget) {
        this.activeGuides.push(this.createHorizontalGuide(horizontalTarget.y, nodeId));
      }
      if (verticalTarget) {
        this.activeGuides.push(this.createVerticalGuide(verticalTarget.x, nodeId));
      }
    }

    return {
      position: { x: snappedX, y: snappedY },
      snapped,
      horizontalTarget,
      verticalTarget,
    };
  }

  /**
   * Find snap points from other nodes
   */
  private findNodeSnapPoints(
    position: Point,
    otherPositions: Map<string, Point>
  ): { horizontalSnap: Point | null; verticalSnap: Point | null } {
    let horizontalSnap: Point | null = null;
    let verticalSnap: Point | null = null;
    let minHorizontalDist = this.config.snapThreshold;
    let minVerticalDist = this.config.snapThreshold;

    for (const [, other] of otherPositions) {
      // Check horizontal alignment (same Y)
      const yDist = Math.abs(position.y - other.y);
      if (yDist < minHorizontalDist) {
        minHorizontalDist = yDist;
        horizontalSnap = other;
      }

      // Check vertical alignment (same X)
      const xDist = Math.abs(position.x - other.x);
      if (xDist < minVerticalDist) {
        minVerticalDist = xDist;
        verticalSnap = other;
      }
    }

    return { horizontalSnap, verticalSnap };
  }

  /**
   * Find snap point on grid
   */
  private findGridSnapPoint(position: Point): Point {
    const gridSize = this.config.gridSize;

    return {
      x: Math.round(position.x / gridSize) * gridSize,
      y: Math.round(position.y / gridSize) * gridSize,
    };
  }

  /**
   * Find closest custom snap point
   */
  private findCustomSnapPoint(position: Point): Point | null {
    let closest: Point | null = null;
    let minDist = this.config.snapThreshold;

    for (const customPos of this.config.customSnapPositions) {
      const dx = position.x - customPos.x;
      const dy = position.y - customPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < minDist) {
        minDist = dist;
        closest = customPos;
      }
    }

    return closest;
  }

  /**
   * Create a horizontal alignment guide
   */
  private createHorizontalGuide(y: number, nodeId: string): AlignmentGuide {
    return {
      axis: "horizontal",
      position: y,
      start: { x: -10000, y },
      end: { x: 10000, y },
      nodeIds: [nodeId],
    };
  }

  /**
   * Create a vertical alignment guide
   */
  private createVerticalGuide(x: number, nodeId: string): AlignmentGuide {
    return {
      axis: "vertical",
      position: x,
      start: { x, y: -10000 },
      end: { x, y: 10000 },
      nodeIds: [nodeId],
    };
  }

  /**
   * Get active alignment guides
   */
  getActiveGuides(): AlignmentGuide[] {
    return [...this.activeGuides];
  }

  /**
   * Clear active guides
   */
  clearGuides(): void {
    this.activeGuides = [];
  }

  /**
   * Enable/disable snapping
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Check if snapping is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Set snap threshold
   */
  setSnapThreshold(threshold: number): void {
    this.config.snapThreshold = Math.max(1, threshold);
  }

  /**
   * Get snap threshold
   */
  getSnapThreshold(): number {
    return this.config.snapThreshold;
  }

  /**
   * Enable/disable snap to nodes
   */
  setSnapToNodes(enabled: boolean): void {
    this.config.snapToNodes = enabled;
  }

  /**
   * Enable/disable snap to grid
   */
  setSnapToGrid(enabled: boolean): void {
    this.config.snapToGrid = enabled;
  }

  /**
   * Set grid size
   */
  setGridSize(size: number): void {
    this.config.gridSize = Math.max(1, size);
  }

  /**
   * Get grid size
   */
  getGridSize(): number {
    return this.config.gridSize;
  }

  /**
   * Enable/disable guides
   */
  setShowGuides(show: boolean): void {
    this.config.showGuides = show;
  }

  /**
   * Add a custom snap position
   */
  addCustomSnapPosition(position: Point): void {
    this.config.customSnapPositions.push({ ...position });
  }

  /**
   * Remove a custom snap position
   */
  removeCustomSnapPosition(position: Point): boolean {
    const index = this.config.customSnapPositions.findIndex(
      (p) => Math.abs(p.x - position.x) < 0.01 && Math.abs(p.y - position.y) < 0.01
    );
    if (index !== -1) {
      this.config.customSnapPositions.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Clear all custom snap positions
   */
  clearCustomSnapPositions(): void {
    this.config.customSnapPositions = [];
  }

  /**
   * Set guide style
   */
  setGuideStyle(color?: string, opacity?: number, width?: number): void {
    if (color !== undefined) this.config.guideColor = color;
    if (opacity !== undefined) this.config.guideOpacity = opacity;
    if (width !== undefined) this.config.guideWidth = width;
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<SnapConfig> {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<SnapConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create a snap manager instance
 */
export function createSnapManager(config?: Partial<SnapConfig>): SnapManager {
  return new SnapManager(config);
}

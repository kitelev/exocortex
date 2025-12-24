/**
 * EdgeRenderer - Edge rendering with curved paths, arrows, and semantic styling
 *
 * Provides flexible edge visualization for graph rendering with:
 * - Multiple curve types (straight, quadratic, bezier, arc)
 * - Configurable line styles (width, color, dashes)
 * - Arrow rendering (arrow, diamond, circle) at configurable positions
 * - Bidirectional edge support
 * - Hover and selection states
 * - Semantic styling based on predicate type
 * - Object pooling for performance optimization
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import { Container, Graphics } from "pixi.js";

/**
 * Position interface for source and target points
 */
export interface Position {
  x: number;
  y: number;
}

/**
 * Available curve types for edges
 */
export type CurveType = "straight" | "quadratic" | "bezier" | "arc";

/**
 * Available arrow types for edge endpoints
 */
export type ArrowType = "none" | "arrow" | "diamond" | "circle";

/**
 * Arrow position options
 */
export type ArrowPosition = "end" | "middle" | "both";

/**
 * Edge visual style configuration
 */
export interface EdgeVisualStyle {
  // Line style
  /** Line width in pixels */
  width: number;
  /** Line color (hex number) */
  color: number;
  /** Line alpha (0-1) */
  alpha: number;
  /** Optional dash array for dashed/dotted lines (e.g., [5, 3] for dashed) */
  dashArray?: number[];

  // Curvature
  /** Type of curve to draw */
  curveType: CurveType;
  /** Curvature amount (0 = straight, 1 = max curve) */
  curvature: number;

  // Arrow
  /** Type of arrow to draw */
  arrowType: ArrowType;
  /** Arrow size in pixels */
  arrowSize: number;
  /** Where to position the arrow */
  arrowPosition: ArrowPosition;

  // Bidirectional
  /** Whether to show arrows on both ends */
  bidirectional: boolean;

  // States
  /** Line width on hover */
  hoverWidth: number;
  /** Line color on hover (hex number) */
  hoverColor: number;
  /** Line width when selected */
  selectedWidth: number;
  /** Line color when selected (hex number) */
  selectedColor: number;
}

/**
 * Default edge visual style
 */
export const DEFAULT_EDGE_STYLE: EdgeVisualStyle = {
  width: 1,
  color: 0x9ca3af, // gray-400
  alpha: 0.6,
  curveType: "straight",
  curvature: 0,
  arrowType: "arrow",
  arrowSize: 6,
  arrowPosition: "end",
  bidirectional: false,
  hoverWidth: 2,
  hoverColor: 0x60a5fa, // blue-400
  selectedWidth: 2,
  selectedColor: 0xfbbf24, // amber-400
};

/**
 * Predicate type for edge type resolution
 */
export type PredicateType =
  | "ems__Effort_parent"
  | "exo__Asset_prototype"
  | "ems__Task_blockedBy"
  | "exo__Asset_relatedTo"
  | string;

/**
 * Edge type configuration for predicate-based styling
 */
export interface EdgeTypeConfig {
  /** Predicate URI or identifier */
  predicateUri: PredicateType;
  /** Display name for the type */
  displayName: string;
  /** Visual style for this type */
  style: Partial<EdgeVisualStyle>;
}

/**
 * Predefined edge type configurations
 */
export const DEFAULT_EDGE_TYPE_CONFIGS: EdgeTypeConfig[] = [
  {
    predicateUri: "ems__Effort_parent",
    displayName: "Parent",
    style: {
      color: 0x22c55e, // green-500
      arrowType: "arrow",
      curveType: "straight",
    },
  },
  {
    predicateUri: "exo__Asset_prototype",
    displayName: "Prototype",
    style: {
      color: 0x8b5cf6, // violet-500
      arrowType: "diamond",
      curveType: "quadratic",
      curvature: 0.2,
    },
  },
  {
    predicateUri: "ems__Task_blockedBy",
    displayName: "Blocked By",
    style: {
      color: 0xef4444, // red-500
      arrowType: "arrow",
      dashArray: [4, 2],
    },
  },
  {
    predicateUri: "exo__Asset_relatedTo",
    displayName: "Related",
    style: {
      color: 0x6b7280, // gray-500
      arrowType: "none",
      curveType: "bezier",
      curvature: 0.3,
    },
  },
];

/**
 * Curve points for different curve types
 */
export interface CurvePoints {
  source: Position;
  target: Position;
  control1?: Position;
  control2?: Position;
}

/**
 * Rendered edge object
 */
export interface RenderedEdge {
  /** Main container for all edge graphics */
  container: Container;
  /** Line graphics */
  lineGraphics: Graphics;
  /** Arrow graphics (optional) */
  arrowGraphics?: Graphics;
  /** Edge ID */
  edgeId: string;
  /** Source node ID */
  sourceId: string;
  /** Target node ID */
  targetId: string;
  /** Current style */
  style: EdgeVisualStyle;
  /** Whether edge is currently hovered */
  isHovered: boolean;
  /** Whether edge is currently selected */
  isSelected: boolean;
  /** Current source position */
  sourcePosition: Position;
  /** Current target position */
  targetPosition: Position;
}

/**
 * EdgeStyleResolver - Resolves edge visual styles based on predicate type
 */
export class EdgeStyleResolver {
  private typeConfigs: Map<string, EdgeTypeConfig> = new Map();
  private defaultStyle: EdgeVisualStyle;

  constructor(
    typeConfigs: EdgeTypeConfig[] = DEFAULT_EDGE_TYPE_CONFIGS,
    defaultStyle: EdgeVisualStyle = DEFAULT_EDGE_STYLE
  ) {
    this.defaultStyle = { ...defaultStyle };
    for (const config of typeConfigs) {
      this.typeConfigs.set(config.predicateUri, config);
    }
  }

  /**
   * Get visual style for a given predicate type
   *
   * @param predicateType - The predicate URI or identifier
   * @returns Merged visual style
   */
  resolveStyle(predicateType?: string): EdgeVisualStyle {
    if (!predicateType) {
      return { ...this.defaultStyle };
    }

    const config = this.typeConfigs.get(predicateType);
    if (!config) {
      return { ...this.defaultStyle };
    }

    return { ...this.defaultStyle, ...config.style };
  }

  /**
   * Register a new type configuration
   *
   * @param config - Edge type configuration to register
   */
  registerType(config: EdgeTypeConfig): void {
    this.typeConfigs.set(config.predicateUri, config);
  }

  /**
   * Get all registered type configurations
   */
  getTypeConfigs(): EdgeTypeConfig[] {
    return Array.from(this.typeConfigs.values());
  }

  /**
   * Set the default style
   *
   * @param style - Partial style to merge with defaults
   */
  setDefaultStyle(style: Partial<EdgeVisualStyle>): void {
    this.defaultStyle = { ...this.defaultStyle, ...style };
  }

  /**
   * Get the default style
   */
  getDefaultStyle(): EdgeVisualStyle {
    return { ...this.defaultStyle };
  }
}

/**
 * Object pool for Graphics objects (performance optimization)
 */
class GraphicsPool {
  private pool: Graphics[] = [];
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  /**
   * Acquire a Graphics object from the pool
   */
  acquire(): Graphics {
    if (this.pool.length > 0) {
      const graphics = this.pool.pop()!;
      graphics.clear();
      return graphics;
    }
    return new Graphics();
  }

  /**
   * Release a Graphics object back to the pool
   */
  release(graphics: Graphics): void {
    if (this.pool.length < this.maxSize) {
      graphics.clear();
      graphics.removeFromParent();
      this.pool.push(graphics);
    } else {
      graphics.destroy();
    }
  }

  /**
   * Clear the pool and destroy all objects
   */
  clear(): void {
    for (const graphics of this.pool) {
      graphics.destroy();
    }
    this.pool = [];
  }

  /**
   * Get current pool size
   */
  size(): number {
    return this.pool.length;
  }
}

/**
 * EdgeRenderer - High-performance edge rendering with curved paths
 */
export class EdgeRenderer {
  private styleResolver: EdgeStyleResolver;
  private graphicsPool: GraphicsPool;
  private renderedEdges: Map<string, RenderedEdge> = new Map();

  constructor(
    styleResolver: EdgeStyleResolver = new EdgeStyleResolver(),
    options: {
      poolSize?: number;
    } = {}
  ) {
    this.styleResolver = styleResolver;
    this.graphicsPool = new GraphicsPool(options.poolSize ?? 1000);
  }

  /**
   * Calculate curve control points based on curve type
   *
   * @param source - Source position
   * @param target - Target position
   * @param style - Edge visual style
   * @returns Curve points with control points if applicable
   */
  calculateCurve(
    source: Position,
    target: Position,
    style: EdgeVisualStyle
  ): CurvePoints {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (style.curveType === "straight" || style.curvature === 0) {
      return { source, target };
    }

    // Perpendicular offset for curve control points
    const perpX = -dy / distance;
    const perpY = dx / distance;
    const offset = distance * style.curvature * 0.5;

    // Midpoint
    const midX = (source.x + target.x) / 2;
    const midY = (source.y + target.y) / 2;

    switch (style.curveType) {
      case "quadratic": {
        // Single control point for quadratic curve
        return {
          source,
          target,
          control1: {
            x: midX + perpX * offset,
            y: midY + perpY * offset,
          },
        };
      }

      case "bezier": {
        // Two control points for bezier curve
        const quarterX = source.x + dx * 0.25;
        const quarterY = source.y + dy * 0.25;
        const threeQuarterX = source.x + dx * 0.75;
        const threeQuarterY = source.y + dy * 0.75;

        return {
          source,
          target,
          control1: {
            x: quarterX + perpX * offset,
            y: quarterY + perpY * offset,
          },
          control2: {
            x: threeQuarterX + perpX * offset,
            y: threeQuarterY + perpY * offset,
          },
        };
      }

      case "arc": {
        // Arc uses single control point with stronger curvature
        return {
          source,
          target,
          control1: {
            x: midX + perpX * offset * 2,
            y: midY + perpY * offset * 2,
          },
        };
      }

      default:
        return { source, target };
    }
  }

  /**
   * Draw a curve path on graphics
   *
   * @param graphics - Graphics object to draw on
   * @param curve - Curve points
   * @param curveType - Type of curve to draw
   */
  drawCurve(
    graphics: Graphics,
    curve: CurvePoints,
    curveType: CurveType
  ): void {
    graphics.moveTo(curve.source.x, curve.source.y);

    switch (curveType) {
      case "straight":
        graphics.lineTo(curve.target.x, curve.target.y);
        break;

      case "quadratic":
      case "arc":
        if (curve.control1) {
          graphics.quadraticCurveTo(
            curve.control1.x,
            curve.control1.y,
            curve.target.x,
            curve.target.y
          );
        } else {
          graphics.lineTo(curve.target.x, curve.target.y);
        }
        break;

      case "bezier":
        if (curve.control1 && curve.control2) {
          graphics.bezierCurveTo(
            curve.control1.x,
            curve.control1.y,
            curve.control2.x,
            curve.control2.y,
            curve.target.x,
            curve.target.y
          );
        } else if (curve.control1) {
          graphics.quadraticCurveTo(
            curve.control1.x,
            curve.control1.y,
            curve.target.x,
            curve.target.y
          );
        } else {
          graphics.lineTo(curve.target.x, curve.target.y);
        }
        break;
    }
  }

  /**
   * Get position and angle at a point on the curve (for arrow placement)
   *
   * @param curve - Curve points
   * @param t - Parameter (0 = source, 1 = target)
   * @param curveType - Type of curve
   * @returns Position and angle at the point
   */
  getPointOnCurve(
    curve: CurvePoints,
    t: number,
    curveType: CurveType
  ): { position: Position; angle: number } {
    let position: Position;
    let tangentX: number;
    let tangentY: number;

    switch (curveType) {
      case "straight": {
        position = {
          x: curve.source.x + (curve.target.x - curve.source.x) * t,
          y: curve.source.y + (curve.target.y - curve.source.y) * t,
        };
        tangentX = curve.target.x - curve.source.x;
        tangentY = curve.target.y - curve.source.y;
        break;
      }

      case "quadratic":
      case "arc": {
        if (curve.control1) {
          // B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
          const mt = 1 - t;
          position = {
            x:
              mt * mt * curve.source.x +
              2 * mt * t * curve.control1.x +
              t * t * curve.target.x,
            y:
              mt * mt * curve.source.y +
              2 * mt * t * curve.control1.y +
              t * t * curve.target.y,
          };
          // Derivative: B'(t) = 2(1-t)(P1-P0) + 2t(P2-P1)
          tangentX =
            2 * mt * (curve.control1.x - curve.source.x) +
            2 * t * (curve.target.x - curve.control1.x);
          tangentY =
            2 * mt * (curve.control1.y - curve.source.y) +
            2 * t * (curve.target.y - curve.control1.y);
        } else {
          position = {
            x: curve.source.x + (curve.target.x - curve.source.x) * t,
            y: curve.source.y + (curve.target.y - curve.source.y) * t,
          };
          tangentX = curve.target.x - curve.source.x;
          tangentY = curve.target.y - curve.source.y;
        }
        break;
      }

      case "bezier": {
        if (curve.control1 && curve.control2) {
          // B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
          const mt = 1 - t;
          const mt2 = mt * mt;
          const mt3 = mt2 * mt;
          const t2 = t * t;
          const t3 = t2 * t;

          position = {
            x:
              mt3 * curve.source.x +
              3 * mt2 * t * curve.control1.x +
              3 * mt * t2 * curve.control2.x +
              t3 * curve.target.x,
            y:
              mt3 * curve.source.y +
              3 * mt2 * t * curve.control1.y +
              3 * mt * t2 * curve.control2.y +
              t3 * curve.target.y,
          };
          // Derivative
          tangentX =
            3 * mt2 * (curve.control1.x - curve.source.x) +
            6 * mt * t * (curve.control2.x - curve.control1.x) +
            3 * t2 * (curve.target.x - curve.control2.x);
          tangentY =
            3 * mt2 * (curve.control1.y - curve.source.y) +
            6 * mt * t * (curve.control2.y - curve.control1.y) +
            3 * t2 * (curve.target.y - curve.control2.y);
        } else {
          position = {
            x: curve.source.x + (curve.target.x - curve.source.x) * t,
            y: curve.source.y + (curve.target.y - curve.source.y) * t,
          };
          tangentX = curve.target.x - curve.source.x;
          tangentY = curve.target.y - curve.source.y;
        }
        break;
      }

      default:
        position = {
          x: curve.source.x + (curve.target.x - curve.source.x) * t,
          y: curve.source.y + (curve.target.y - curve.source.y) * t,
        };
        tangentX = curve.target.x - curve.source.x;
        tangentY = curve.target.y - curve.source.y;
    }

    const angle = Math.atan2(tangentY, tangentX);
    return { position, angle };
  }

  /**
   * Draw an arrow at a position with given angle
   *
   * @param graphics - Graphics object to draw on
   * @param position - Position to draw arrow at
   * @param angle - Angle of the arrow (in radians)
   * @param style - Edge visual style
   * @param reverse - Whether to reverse the arrow direction
   */
  drawArrow(
    graphics: Graphics,
    position: Position,
    angle: number,
    style: EdgeVisualStyle,
    reverse: boolean = false
  ): void {
    const size = style.arrowSize;
    const effectiveAngle = reverse ? angle + Math.PI : angle;

    switch (style.arrowType) {
      case "arrow": {
        // Classic arrow shape
        const arrowAngle = Math.PI / 6; // 30 degrees
        const x1 =
          position.x - size * Math.cos(effectiveAngle - arrowAngle);
        const y1 =
          position.y - size * Math.sin(effectiveAngle - arrowAngle);
        const x2 =
          position.x - size * Math.cos(effectiveAngle + arrowAngle);
        const y2 =
          position.y - size * Math.sin(effectiveAngle + arrowAngle);

        graphics.moveTo(position.x, position.y);
        graphics.lineTo(x1, y1);
        graphics.moveTo(position.x, position.y);
        graphics.lineTo(x2, y2);
        break;
      }

      case "diamond": {
        // Diamond shape
        const halfSize = size * 0.7;
        const dx = Math.cos(effectiveAngle);
        const dy = Math.sin(effectiveAngle);
        const perpDx = -dy;
        const perpDy = dx;

        const front = {
          x: position.x,
          y: position.y,
        };
        const back = {
          x: position.x - size * dx,
          y: position.y - size * dy,
        };
        const left = {
          x: position.x - halfSize * dx + halfSize * 0.5 * perpDx,
          y: position.y - halfSize * dy + halfSize * 0.5 * perpDy,
        };
        const right = {
          x: position.x - halfSize * dx - halfSize * 0.5 * perpDx,
          y: position.y - halfSize * dy - halfSize * 0.5 * perpDy,
        };

        graphics.moveTo(front.x, front.y);
        graphics.lineTo(left.x, left.y);
        graphics.lineTo(back.x, back.y);
        graphics.lineTo(right.x, right.y);
        graphics.closePath();
        break;
      }

      case "circle": {
        // Circle shape
        const circleX = position.x - (size / 2) * Math.cos(effectiveAngle);
        const circleY = position.y - (size / 2) * Math.sin(effectiveAngle);
        graphics.circle(circleX, circleY, size / 2);
        break;
      }

      case "none":
      default:
        // No arrow
        break;
    }
  }

  /**
   * Get the style properties for current state
   *
   * @param style - Base edge style
   * @param state - Current state
   * @returns Style properties for the state
   */
  private getStyleForState(
    style: EdgeVisualStyle,
    state: "normal" | "hover" | "selected"
  ): { width: number; color: number; alpha: number } {
    switch (state) {
      case "hover":
        return {
          width: style.hoverWidth,
          color: style.hoverColor,
          alpha: 1,
        };
      case "selected":
        return {
          width: style.selectedWidth,
          color: style.selectedColor,
          alpha: 1,
        };
      default:
        return {
          width: style.width,
          color: style.color,
          alpha: style.alpha,
        };
    }
  }

  /**
   * Draw an edge line with the given style
   *
   * @param graphics - Graphics object to draw on
   * @param source - Source position
   * @param target - Target position
   * @param style - Visual style to apply
   * @param isHovered - Whether edge is hovered
   * @param isSelected - Whether edge is selected
   */
  drawEdgeLine(
    graphics: Graphics,
    source: Position,
    target: Position,
    style: EdgeVisualStyle,
    isHovered: boolean = false,
    isSelected: boolean = false
  ): void {
    graphics.clear();

    const state: "normal" | "hover" | "selected" = isSelected
      ? "selected"
      : isHovered
        ? "hover"
        : "normal";

    const { width, color, alpha } = this.getStyleForState(style, state);

    // Calculate curve
    const curve = this.calculateCurve(source, target, style);

    // Draw the line
    graphics.setStrokeStyle({
      width,
      color,
      alpha,
      cap: "round",
      join: "round",
    });

    this.drawCurve(graphics, curve, style.curveType);
    graphics.stroke();
  }

  /**
   * Draw edge arrows
   *
   * @param graphics - Graphics object to draw on
   * @param source - Source position
   * @param target - Target position
   * @param style - Visual style to apply
   * @param isHovered - Whether edge is hovered
   * @param isSelected - Whether edge is selected
   */
  drawEdgeArrows(
    graphics: Graphics,
    source: Position,
    target: Position,
    style: EdgeVisualStyle,
    isHovered: boolean = false,
    isSelected: boolean = false
  ): void {
    if (style.arrowType === "none") return;

    graphics.clear();

    const state: "normal" | "hover" | "selected" = isSelected
      ? "selected"
      : isHovered
        ? "hover"
        : "normal";

    const { width, color, alpha } = this.getStyleForState(style, state);

    const curve = this.calculateCurve(source, target, style);

    graphics.setStrokeStyle({
      width,
      color,
      alpha,
      cap: "round",
      join: "round",
    });

    // Draw arrow at end
    if (style.arrowPosition === "end" || style.arrowPosition === "both") {
      const endPoint = this.getPointOnCurve(curve, 0.95, style.curveType);
      this.drawArrow(graphics, endPoint.position, endPoint.angle, style, false);
    }

    // Draw arrow in middle
    if (style.arrowPosition === "middle") {
      const midPoint = this.getPointOnCurve(curve, 0.5, style.curveType);
      this.drawArrow(graphics, midPoint.position, midPoint.angle, style, false);
    }

    // Draw arrow at start (for both ends)
    if (style.arrowPosition === "both") {
      const startPoint = this.getPointOnCurve(curve, 0.05, style.curveType);
      this.drawArrow(graphics, startPoint.position, startPoint.angle, style, true);
    }

    // Draw bidirectional arrow
    if (style.bidirectional) {
      const startPoint = this.getPointOnCurve(curve, 0.05, style.curveType);
      this.drawArrow(graphics, startPoint.position, startPoint.angle, style, true);
    }

    graphics.stroke();

    // Fill for diamond and circle arrows
    if (style.arrowType === "diamond" || style.arrowType === "circle") {
      graphics.fill({ color, alpha });
    }
  }

  /**
   * Create a rendered edge
   *
   * @param edgeId - Unique edge identifier
   * @param sourceId - Source node ID
   * @param targetId - Target node ID
   * @param source - Source position
   * @param target - Target position
   * @param predicateType - Predicate type for style resolution
   * @returns Rendered edge object
   */
  createEdge(
    edgeId: string,
    sourceId: string,
    targetId: string,
    source: Position,
    target: Position,
    predicateType?: string
  ): RenderedEdge {
    // Check if edge already exists
    const existing = this.renderedEdges.get(edgeId);
    if (existing) {
      return existing;
    }

    const style = this.styleResolver.resolveStyle(predicateType);
    const container = new Container();
    const lineGraphics = this.graphicsPool.acquire();

    // Draw initial line
    this.drawEdgeLine(lineGraphics, source, target, style, false, false);
    container.addChild(lineGraphics);

    // Create arrow graphics if needed
    let arrowGraphics: Graphics | undefined;
    if (style.arrowType !== "none") {
      arrowGraphics = this.graphicsPool.acquire();
      this.drawEdgeArrows(arrowGraphics, source, target, style, false, false);
      container.addChild(arrowGraphics);
    }

    const renderedEdge: RenderedEdge = {
      container,
      lineGraphics,
      arrowGraphics,
      edgeId,
      sourceId,
      targetId,
      style,
      isHovered: false,
      isSelected: false,
      sourcePosition: { ...source },
      targetPosition: { ...target },
    };

    this.renderedEdges.set(edgeId, renderedEdge);
    return renderedEdge;
  }

  /**
   * Update a rendered edge
   *
   * @param edgeId - Edge ID to update
   * @param source - New source position
   * @param target - New target position
   * @param isHovered - Whether edge is hovered
   * @param isSelected - Whether edge is selected
   */
  updateEdge(
    edgeId: string,
    source: Position,
    target: Position,
    isHovered: boolean = false,
    isSelected: boolean = false
  ): void {
    const edge = this.renderedEdges.get(edgeId);
    if (!edge) return;

    // Check if position or state changed
    const positionChanged =
      edge.sourcePosition.x !== source.x ||
      edge.sourcePosition.y !== source.y ||
      edge.targetPosition.x !== target.x ||
      edge.targetPosition.y !== target.y;

    const stateChanged =
      edge.isHovered !== isHovered || edge.isSelected !== isSelected;

    if (positionChanged || stateChanged) {
      edge.sourcePosition = { ...source };
      edge.targetPosition = { ...target };
      edge.isHovered = isHovered;
      edge.isSelected = isSelected;

      // Redraw
      this.drawEdgeLine(
        edge.lineGraphics,
        source,
        target,
        edge.style,
        isHovered,
        isSelected
      );

      if (edge.arrowGraphics && edge.style.arrowType !== "none") {
        this.drawEdgeArrows(
          edge.arrowGraphics,
          source,
          target,
          edge.style,
          isHovered,
          isSelected
        );
      }
    }
  }

  /**
   * Update edge style (e.g., when predicate type changes)
   *
   * @param edgeId - Edge ID to update
   * @param predicateType - New predicate type
   */
  updateEdgeStyle(edgeId: string, predicateType?: string): void {
    const edge = this.renderedEdges.get(edgeId);
    if (!edge) return;

    const newStyle = this.styleResolver.resolveStyle(predicateType);
    const styleChanged =
      edge.style.arrowType !== newStyle.arrowType ||
      edge.style.curveType !== newStyle.curveType ||
      edge.style.color !== newStyle.color ||
      edge.style.width !== newStyle.width;

    if (!styleChanged) return;

    edge.style = newStyle;

    // Redraw with new style
    this.drawEdgeLine(
      edge.lineGraphics,
      edge.sourcePosition,
      edge.targetPosition,
      newStyle,
      edge.isHovered,
      edge.isSelected
    );

    // Handle arrow graphics changes
    if (newStyle.arrowType !== "none" && !edge.arrowGraphics) {
      // Need to create arrow graphics
      edge.arrowGraphics = this.graphicsPool.acquire();
      edge.container.addChild(edge.arrowGraphics);
    } else if (newStyle.arrowType === "none" && edge.arrowGraphics) {
      // Need to remove arrow graphics
      this.graphicsPool.release(edge.arrowGraphics);
      edge.arrowGraphics = undefined;
    }

    if (edge.arrowGraphics && newStyle.arrowType !== "none") {
      this.drawEdgeArrows(
        edge.arrowGraphics,
        edge.sourcePosition,
        edge.targetPosition,
        newStyle,
        edge.isHovered,
        edge.isSelected
      );
    }
  }

  /**
   * Remove a rendered edge
   *
   * @param edgeId - Edge ID to remove
   */
  removeEdge(edgeId: string): void {
    const edge = this.renderedEdges.get(edgeId);
    if (!edge) return;

    // Release graphics to pool
    this.graphicsPool.release(edge.lineGraphics);

    if (edge.arrowGraphics) {
      this.graphicsPool.release(edge.arrowGraphics);
    }

    // Destroy container
    edge.container.destroy({ children: false });

    this.renderedEdges.delete(edgeId);
  }

  /**
   * Get a rendered edge by ID
   *
   * @param edgeId - Edge ID
   * @returns Rendered edge or undefined
   */
  getEdge(edgeId: string): RenderedEdge | undefined {
    return this.renderedEdges.get(edgeId);
  }

  /**
   * Get all rendered edges
   */
  getAllEdges(): RenderedEdge[] {
    return Array.from(this.renderedEdges.values());
  }

  /**
   * Get edges connected to a node
   *
   * @param nodeId - Node ID
   * @returns Array of rendered edges
   */
  getEdgesForNode(nodeId: string): RenderedEdge[] {
    return Array.from(this.renderedEdges.values()).filter(
      (edge) => edge.sourceId === nodeId || edge.targetId === nodeId
    );
  }

  /**
   * Clear all rendered edges
   */
  clear(): void {
    for (const edge of this.renderedEdges.values()) {
      this.graphicsPool.release(edge.lineGraphics);
      if (edge.arrowGraphics) {
        this.graphicsPool.release(edge.arrowGraphics);
      }
      edge.container.destroy({ children: false });
    }
    this.renderedEdges.clear();
  }

  /**
   * Destroy the renderer and release all resources
   */
  destroy(): void {
    this.clear();
    this.graphicsPool.clear();
  }

  /**
   * Get the style resolver
   */
  getStyleResolver(): EdgeStyleResolver {
    return this.styleResolver;
  }

  /**
   * Get statistics
   */
  getStats(): {
    renderedEdgeCount: number;
    poolSize: number;
  } {
    return {
      renderedEdgeCount: this.renderedEdges.size,
      poolSize: this.graphicsPool.size(),
    };
  }
}

/**
 * Calculate edge path avoiding node centers
 *
 * @param source - Source node position
 * @param target - Target node position
 * @param sourceRadius - Source node radius
 * @param targetRadius - Target node radius
 * @returns Adjusted source and target positions at node edges
 */
export function calculateEdgeEndpoints(
  source: Position,
  target: Position,
  sourceRadius: number,
  targetRadius: number
): { source: Position; target: Position } {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance === 0) {
    return { source, target };
  }

  // Normalize direction
  const nx = dx / distance;
  const ny = dy / distance;

  return {
    source: {
      x: source.x + nx * sourceRadius,
      y: source.y + ny * sourceRadius,
    },
    target: {
      x: target.x - nx * targetRadius,
      y: target.y - ny * targetRadius,
    },
  };
}
